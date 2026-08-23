param(
    [string]$ServerIp = "192.168.1.60",
    [ValidateSet("All", "Kubernetes", "K3s")]
    [string]$Component = "All",
    [string]$Version = "",
    [string]$KubernetesVersion = "v1.36.3",
    [string]$KubernetesMinor = "v1.36",
    [string]$CalicoVersion = "v3.32.0",
    [string]$K3sChannel = "stable",
    [ValidateSet("amd64", "arm64")]
    [string]$Architecture = "amd64"
)

$ErrorActionPreference = "Stop"
$MirrorRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$CaPath = Join-Path $MirrorRoot "runtime/certs/ca.crt"
$ManifestDirectory = Join-Path $MirrorRoot "runtime/manifests"
$PrewarmAssets = [System.Collections.Generic.List[object]]::new()
$RpmArchitecture = if ($Architecture -eq "amd64") { "x86_64" } else { "aarch64" }
$ManifestAccept = "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json"
$WarmKubernetes = $Component -in @("All", "Kubernetes")
$WarmK3s = $Component -in @("All", "K3s")

if ($Version -and $Component -eq "All") {
    throw "-Version requires -Component Kubernetes or -Component K3s. Use the component-specific version parameters with -Component All."
}

if ($Component -eq "Kubernetes" -and $Version) {
    if ($Version -notmatch '^v(\d+)\.(\d+)\.(\d+)$') {
        throw "Invalid Kubernetes version '$Version'. Expected format: v1.36.3."
    }
    $KubernetesVersion = $Version
    $KubernetesMinor = "v$($Matches[1]).$($Matches[2])"
}

$RequestedK3sVersion = ""
if ($Component -eq "K3s" -and $Version) {
    if ($Version -notmatch '^v\d+\.\d+\.\d+\+k3s\d+$') {
        throw "Invalid K3s version '$Version'. Expected format: v1.36.2+k3s1."
    }
    $RequestedK3sVersion = $Version
}

if (-not (Test-Path -LiteralPath $CaPath)) {
    throw "Mirror CA certificate not found at $CaPath. Run setup.ps1 first."
}

function Invoke-MirrorCurl {
    param(
        [Parameter(Mandatory)]
        [string[]]$Arguments
    )

    $output = & curl.exe --fail --silent --show-error --retry 3 --retry-all-errors --retry-delay 2 --ssl-no-revoke --cacert $CaPath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Mirror request failed with curl exit code $LASTEXITCODE."
    }
    return $output
}

function Get-MirrorText {
    param([Parameter(Mandatory)][string]$Url)
    return (Invoke-MirrorCurl -Arguments @("--location", "--max-time", "900", $Url)) -join "`n"
}

function Warm-Artifact {
    param([Parameter(Mandatory)][string]$Url)
    Invoke-MirrorCurl -Arguments @("--location", "--max-time", "1800", "--output", "NUL", $Url) | Out-Null
    $headerFile = Join-Path $env:TEMP ("lindeploy-" + [IO.Path]::GetRandomFileName() + ".headers")
    try {
        Invoke-MirrorCurl -Arguments @(
            "--head", "--max-time", "30", "--dump-header", $headerFile,
            "--output", "NUL", $Url
        ) | Out-Null
        $headers = Get-Content -LiteralPath $headerFile
        $sha256 = (($headers | Where-Object { $_ -match '^X-Content-SHA256:' } | Select-Object -Last 1) -replace '^X-Content-SHA256:\s*', '').Trim()
        $contentLength = (($headers | Where-Object { $_ -match '^Content-Length:' } | Select-Object -Last 1) -replace '^Content-Length:\s*', '').Trim()
        if ($sha256 -notmatch '^[a-f0-9]{64}$') {
            throw "Mirror did not return a verified SHA-256 digest for $Url."
        }
        $script:PrewarmAssets.Add([ordered]@{
            url = $Url
            sha256 = $sha256
            size = if ($contentLength -match '^\d+$') { [long]$contentLength } else { 0 }
        })
    }
    finally {
        Remove-Item -Force -ErrorAction SilentlyContinue $headerFile
    }
    Write-Host "Artifact cached: $Url"
}

function Expand-GzipText {
    param([Parameter(Mandatory)][string]$Path)

    $inputStream = [IO.File]::OpenRead($Path)
    try {
        $gzipStream = [IO.Compression.GzipStream]::new(
            $inputStream,
            [IO.Compression.CompressionMode]::Decompress
        )
        try {
            $reader = [IO.StreamReader]::new($gzipStream)
            try {
                return $reader.ReadToEnd()
            }
            finally {
                $reader.Dispose()
            }
        }
        finally {
            $gzipStream.Dispose()
        }
    }
    finally {
        $inputStream.Dispose()
    }
}

function Expand-ZstdText {
    param([Parameter(Mandatory)][string]$Path)

    $python = Get-Command python.exe, python -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $python) {
        throw "Python 3.14 or newer is required to read zstd RPM repository metadata."
    }
    $outputPath = "$Path.xml"
    try {
        & $python.Source (Join-Path $MirrorRoot "decompress_zstd.py") $Path $outputPath
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $outputPath)) {
            throw "Unable to decompress zstd RPM repository metadata. Install Python 3.14 or newer and retry."
        }
        return Get-Content -Raw -LiteralPath $outputPath
    }
    finally {
        Remove-Item -Force -ErrorAction SilentlyContinue $outputPath
    }
}

function Expand-RepositoryMetadataText {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Location
    )

    if ($Location -match '\.gz$') {
        return Expand-GzipText -Path $Path
    }
    if ($Location -match '\.zst$') {
        return Expand-ZstdText -Path $Path
    }
    if ($Location -match '\.xml$') {
        return Get-Content -Raw -LiteralPath $Path
    }
    throw "Unsupported RPM primary metadata format: $Location"
}

function Warm-RpmRepository {
    param(
        [Parameter(Mandatory)][string]$BaseUrl,
        [Parameter(Mandatory)][string]$Label,
        [string[]]$PackageNames = @()
    )

    $repomdUrl = "$BaseUrl/repodata/repomd.xml"
    $repomdXml = Get-MirrorText -Url $repomdUrl
    Write-Host "Repository metadata cached: $repomdUrl"
    $metadataLocations = [regex]::Matches($repomdXml, 'href="([^"]+)"') |
        ForEach-Object { $_.Groups[1].Value } |
        Select-Object -Unique
    if (-not $metadataLocations) {
        throw "$Label returned repomd.xml without metadata locations."
    }

    foreach ($location in $metadataLocations) {
        Warm-Artifact -Url "$BaseUrl/$location"
    }

    $primaryLocation = $metadataLocations |
        Where-Object { $_ -match 'primary\.xml(?:\.gz|\.zst)?$' } |
        Select-Object -First 1
    if ($PackageNames.Count -gt 0 -and -not $primaryLocation) {
        throw "$Label does not expose supported primary.xml metadata; required RPM payloads cannot be prewarmed safely."
    }

    if ($primaryLocation) {
        $primaryFile = Join-Path $env:TEMP ("lindeploy-" + [IO.Path]::GetRandomFileName())
        try {
            Invoke-MirrorCurl -Arguments @(
                "--location", "--max-time", "900", "--output", $primaryFile,
                "$BaseUrl/$primaryLocation"
            ) | Out-Null
            $primaryXml = Expand-RepositoryMetadataText -Path $primaryFile -Location $primaryLocation
        }
        finally {
            Remove-Item -Force -ErrorAction SilentlyContinue $primaryFile
        }

        $packageLocations = @{}
        foreach ($packageBlock in [regex]::Matches($primaryXml, '(?s)<package\s+type="rpm">(.*?)</package>')) {
            $nameMatch = [regex]::Match($packageBlock.Groups[1].Value, '<name>([^<]+)</name>')
            $locationMatch = [regex]::Match($packageBlock.Groups[1].Value, '<location\s+href="([^"]+)"')
            if (
                $nameMatch.Success -and
                $locationMatch.Success -and
                $PackageNames -contains $nameMatch.Groups[1].Value
            ) {
                # Repository primary metadata is ordered by package and
                # version. Keep the final location for each requested package
                # so prewarm stores only the newest candidate selected by DNF.
                $packageLocations[$nameMatch.Groups[1].Value] = $locationMatch.Groups[1].Value
            }
        }
        $missingPackages = @($PackageNames | Where-Object { -not $packageLocations.ContainsKey($_) })
        if ($missingPackages.Count -gt 0) {
            throw "$Label is missing required RPM payloads: $($missingPackages -join ', '). The mirror will not be marked ready."
        }
        foreach ($location in $packageLocations.Values | Select-Object -Unique) {
            Warm-Artifact -Url "$BaseUrl/$location"
        }
        Write-Host "$Label RPM payloads cached: $($packageLocations.Count)."
    }

    $readinessUrl = $repomdUrl -replace '/cache/', '/cache-ready/'
    Invoke-MirrorCurl -Arguments @("--max-time", "30", "--output", "NUL", $readinessUrl) | Out-Null
    Write-Host "$Label repository snapshot is complete."
}

function Get-OciManifest {
    param([string]$BaseUrl, [string]$Repository, [string]$Reference)
    $url = "$BaseUrl/v2/$Repository/manifests/$Reference"
    return Get-MirrorText -Url $url -ErrorAction Stop
}

function Warm-OciImage {
    param(
        [Parameter(Mandatory)][string]$Registry,
        [Parameter(Mandatory)][string]$Repository,
        [Parameter(Mandatory)][string]$Reference
    )

    $port = switch ($Registry) {
        "registry.k8s.io" { 5001 }
        "quay.io" { 5002 }
        "docker.io" { 5003 }
        default { throw "Unsupported registry '$Registry'." }
    }
    $baseUrl = "https://${ServerIp}:$port"
    $manifestUrl = "$baseUrl/v2/$Repository/manifests/$Reference"
    $manifestText = (Invoke-MirrorCurl -Arguments @("--max-time", "900", "--header", "Accept: $ManifestAccept", $manifestUrl)) -join "`n"
    $manifest = $manifestText | ConvertFrom-Json

    if ($manifest.manifests) {
        $platformManifest = $manifest.manifests | Where-Object {
            $_.platform.os -eq "linux" -and $_.platform.architecture -eq $Architecture
        } | Select-Object -First 1
        if (-not $platformManifest) {
            throw "No linux/$Architecture manifest found for $Registry/$Repository`:$Reference."
        }
        $platformManifestUrl = "$baseUrl/v2/$Repository/manifests/$($platformManifest.digest)"
        $manifestText = (Invoke-MirrorCurl -Arguments @(
            "--max-time", "900",
            "--header", "Accept: $ManifestAccept",
            $platformManifestUrl
        )) -join "`n"
        $manifest = $manifestText | ConvertFrom-Json
    }

    $descriptors = @($manifest.config) + @($manifest.layers)
    foreach ($descriptor in $descriptors | Where-Object { $_.digest }) {
        $blobUrl = "$baseUrl/v2/$Repository/blobs/$($descriptor.digest)"
        Invoke-MirrorCurl -Arguments @(
            "--location", "--max-time", "1800", "--output", "NUL", $blobUrl
        ) | Out-Null
        if ($descriptor.digest -notmatch '^sha256:[a-f0-9]{64}$') {
            throw "OCI descriptor for $Registry/$Repository has an unsupported digest '$($descriptor.digest)'."
        }
        $script:PrewarmAssets.Add([ordered]@{
            url = $blobUrl
            sha256 = $descriptor.digest.Substring(7)
            size = if ($null -ne $descriptor.size) { [long]$descriptor.size } else { 0 }
        })
    }
    Write-Host "OCI image cached: $Registry/$Repository`:$Reference ($Architecture)"
}

Write-Host "Prewarming LinDeploy $Component content for linux/$Architecture..."

$kubernetesImages = @(
    @{ Registry = "registry.k8s.io"; Repository = "kube-apiserver"; Reference = $KubernetesVersion },
    @{ Registry = "registry.k8s.io"; Repository = "kube-controller-manager"; Reference = $KubernetesVersion },
    @{ Registry = "registry.k8s.io"; Repository = "kube-scheduler"; Reference = $KubernetesVersion },
    @{ Registry = "registry.k8s.io"; Repository = "kube-proxy"; Reference = $KubernetesVersion },
    @{ Registry = "registry.k8s.io"; Repository = "coredns/coredns"; Reference = "v1.14.2" },
    @{ Registry = "registry.k8s.io"; Repository = "pause"; Reference = "3.10.2" },
    @{ Registry = "registry.k8s.io"; Repository = "etcd"; Reference = "3.6.8-0" }
)
$calicoImages = @(
    @{ Registry = "quay.io"; Repository = "calico/cni"; Reference = $CalicoVersion },
    @{ Registry = "quay.io"; Repository = "calico/node"; Reference = $CalicoVersion },
    @{ Registry = "quay.io"; Repository = "calico/kube-controllers"; Reference = $CalicoVersion }
)

if ($WarmKubernetes) {
    foreach ($image in @($kubernetesImages) + @($calicoImages)) {
        Warm-OciImage @image
    }
}

$artifactBase = "https://${ServerIp}:8443/cache"

# Base operating-system repositories are shared by Kubernetes and K3s. Warm
# their complete metadata snapshots and the small set of packages managed by
# the common role so concurrent targets never build the cache during a run.
$redHatBaseOsPackages = @(
    "curl",
    "iproute-tc",
    "libselinux-utils",
    "selinux-policy",
    "tar",
    "firewalld",
    "policycoreutils"
)
$redHatAppStreamPackages = @("container-selinux")
$redHatRepositories = @(
    @{ Label = "CentOS Stream 9 BaseOS"; Url = "$artifactBase/mirror.stream.centos.org/9-stream/BaseOS/$RpmArchitecture/os"; Packages = $redHatBaseOsPackages },
    @{ Label = "CentOS Stream 9 AppStream"; Url = "$artifactBase/mirror.stream.centos.org/9-stream/AppStream/$RpmArchitecture/os"; Packages = $redHatAppStreamPackages },
    @{ Label = "Rocky Linux 9 BaseOS"; Url = "$artifactBase/dl.rockylinux.org/pub/rocky/9/BaseOS/$RpmArchitecture/os"; Packages = $redHatBaseOsPackages },
    @{ Label = "Rocky Linux 9 AppStream"; Url = "$artifactBase/dl.rockylinux.org/pub/rocky/9/AppStream/$RpmArchitecture/os"; Packages = $redHatAppStreamPackages },
    @{ Label = "AlmaLinux 9 BaseOS"; Url = "$artifactBase/repo.almalinux.org/almalinux/9/BaseOS/$RpmArchitecture/os"; Packages = $redHatBaseOsPackages },
    @{ Label = "AlmaLinux 9 AppStream"; Url = "$artifactBase/repo.almalinux.org/almalinux/9/AppStream/$RpmArchitecture/os"; Packages = $redHatAppStreamPackages }
)
foreach ($repository in $redHatRepositories) {
    Warm-RpmRepository -BaseUrl $repository.Url -Label $repository.Label -PackageNames $repository.Packages
}

if ($WarmKubernetes) {
    $dockerRpmBase = "$artifactBase/download.docker.com/linux/centos/9/$RpmArchitecture/stable"
    Warm-Artifact -Url "$artifactBase/download.docker.com/linux/centos/gpg"
    Warm-RpmRepository -BaseUrl $dockerRpmBase -Label "Docker CE CentOS 9" -PackageNames @("containerd.io")

    Warm-Artifact -Url "$artifactBase/raw.githubusercontent.com/projectcalico/calico/$CalicoVersion/manifests/calico.yaml"

    $kubernetesRpmBase = "$artifactBase/pkgs.k8s.io/core:/stable:/$KubernetesMinor/rpm"
    Warm-Artifact -Url "$kubernetesRpmBase/repodata/repomd.xml"
    Warm-Artifact -Url "$kubernetesRpmBase/repodata/repomd.xml.key"
    $repomdXml = Get-MirrorText -Url "$kubernetesRpmBase/repodata/repomd.xml"
    $metadataLocations = [regex]::Matches($repomdXml, 'href="([^"]+)"') |
        ForEach-Object { $_.Groups[1].Value } |
        Select-Object -Unique
    foreach ($location in $metadataLocations) {
        Warm-Artifact -Url "$kubernetesRpmBase/$location"
    }

    $primaryLocation = $metadataLocations | Where-Object { $_ -match 'primary\.xml' } | Select-Object -First 1
    if ($primaryLocation) {
        $primaryFile = Join-Path $env:TEMP ("lindeploy-kubernetes-" + [IO.Path]::GetRandomFileName())
        try {
            Invoke-MirrorCurl -Arguments @(
                "--location", "--max-time", "900", "--output", $primaryFile,
                "$kubernetesRpmBase/$primaryLocation"
            ) | Out-Null
            $primaryXml = Expand-RepositoryMetadataText -Path $primaryFile -Location $primaryLocation
        }
        finally {
            Remove-Item -Force -ErrorAction SilentlyContinue $primaryFile
        }
        $packageLocations = [regex]::Matches(
            $primaryXml,
            '<location href="([^"]+\.(?:rpm|drpm))"'
        ) | ForEach-Object { $_.Groups[1].Value } | Where-Object {
            $_ -match "(?:^|/)(?:$RpmArchitecture|noarch)/(?:kubelet|kubeadm|kubectl|cri-tools|kubernetes-cni)-"
        } | Select-Object -Unique
        foreach ($location in $packageLocations) {
            Warm-Artifact -Url "$kubernetesRpmBase/$location"
        }
        $requiredKubernetesPackages = @("kubelet", "kubeadm", "kubectl", "cri-tools")
        foreach ($requiredPackage in $requiredKubernetesPackages) {
            if (-not ($packageLocations | Where-Object { $_ -match "/$requiredPackage-" })) {
                throw "Kubernetes RPM repository is missing required payload '$requiredPackage'."
            }
        }
    }
}

if ($WarmK3s) {
    Warm-Artifact -Url "$artifactBase/get.k3s.io/"

    if ($RequestedK3sVersion) {
        $k3sVersion = $RequestedK3sVersion
    }
    else {
        $channelUrl = "$artifactBase/update.k3s.io/v1-release/channels/$K3sChannel"
        $effectiveChannelUrl = (Invoke-MirrorCurl -Arguments @(
            "--location", "--max-time", "300", "--output", "NUL", "--write-out", "%{url_effective}", $channelUrl
        )) -join ""
        $k3sVersion = [Uri]::UnescapeDataString(($effectiveChannelUrl.TrimEnd('/') -split '/')[-1])
        if ($k3sVersion -notmatch '^v\d+\.\d+\.\d+\+k3s\d+$') {
            throw "K3s channel '$K3sChannel' resolved to invalid version '$k3sVersion'."
        }
    }
    $encodedK3sVersion = [Uri]::EscapeDataString($k3sVersion)
    Warm-Artifact -Url "$artifactBase/github.com/k3s-io/k3s/releases/download/$encodedK3sVersion/sha256sum-$Architecture.txt"
    Warm-Artifact -Url "$artifactBase/github.com/k3s-io/k3s/releases/download/$encodedK3sVersion/k3s"
    Warm-Artifact -Url "$artifactBase/github.com/k3s-io/k3s/releases/download/$encodedK3sVersion/k3s-airgap-images-$Architecture.tar.zst"

    if ($Architecture -eq "amd64") {
        $k3sSelinuxBase = "$artifactBase/rpm.rancher.io/k3s/stable/common/centos/9/noarch"
        Warm-Artifact -Url "$artifactBase/rpm.rancher.io/public.key"
        Warm-Artifact -Url "$k3sSelinuxBase/repodata/repomd.xml"
        $k3sSelinuxRepomd = Get-MirrorText -Url "$k3sSelinuxBase/repodata/repomd.xml"
        $k3sSelinuxMetadata = [regex]::Matches($k3sSelinuxRepomd, 'href="([^"]+)"') |
            ForEach-Object { $_.Groups[1].Value } |
            Select-Object -Unique
        foreach ($location in $k3sSelinuxMetadata) {
            Warm-Artifact -Url "$k3sSelinuxBase/$location"
        }

        $k3sSelinuxPrimary = $k3sSelinuxMetadata |
            Where-Object { $_ -match 'primary\.xml' } |
            Select-Object -First 1
        if ($k3sSelinuxPrimary) {
            $k3sSelinuxPrimaryFile = Join-Path $env:TEMP ("lindeploy-k3s-selinux-" + [IO.Path]::GetRandomFileName())
            try {
                Invoke-MirrorCurl -Arguments @(
                    "--location", "--max-time", "900", "--output", $k3sSelinuxPrimaryFile,
                    "$k3sSelinuxBase/$k3sSelinuxPrimary"
                ) | Out-Null
                $k3sSelinuxPrimaryXml = Expand-RepositoryMetadataText -Path $k3sSelinuxPrimaryFile -Location $k3sSelinuxPrimary
            }
            finally {
                Remove-Item -Force -ErrorAction SilentlyContinue $k3sSelinuxPrimaryFile
            }
            $k3sSelinuxPackages = [regex]::Matches(
                $k3sSelinuxPrimaryXml,
                '<location href="([^"]*k3s-selinux-[^"]+\.rpm)"'
            ) | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique
            foreach ($location in $k3sSelinuxPackages) {
                Warm-Artifact -Url "$k3sSelinuxBase/$location"
            }
            if ($k3sSelinuxPackages.Count -eq 0) {
                throw "Rancher repository is missing the required k3s-selinux RPM payload."
            }
        }
    }
}

$summary = @()
if ($WarmKubernetes) {
    $summary += "Kubernetes $KubernetesVersion ($KubernetesMinor RPM repo) and Calico $CalicoVersion"
}
if ($WarmK3s) {
    $summary += "K3s $k3sVersion"
}
Write-Host "Mirror prewarm complete: $($summary -join '; ')."

New-Item -ItemType Directory -Force -Path $ManifestDirectory | Out-Null
$manifestVersion = if ($Component -eq "K3s") { $k3sVersion } else { $KubernetesVersion }
$safeManifestVersion = $manifestVersion -replace '[^A-Za-z0-9._+-]', '_'
$manifestPath = Join-Path $ManifestDirectory ("$($Component.ToLowerInvariant())-$safeManifestVersion-$Architecture.json")
$temporaryManifestPath = "$manifestPath.tmp"
[ordered]@{
    schema_version = 1
    component = $Component.ToLowerInvariant()
    version = $manifestVersion
    architecture = $Architecture
    generated_at = [DateTime]::UtcNow.ToString("o")
    asset_count = $PrewarmAssets.Count
    assets = @($PrewarmAssets)
} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $temporaryManifestPath -Encoding UTF8
Move-Item -Force -LiteralPath $temporaryManifestPath -Destination $manifestPath
Write-Host "LINDEPLOY_MANIFEST=$manifestPath"
