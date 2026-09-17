param(
    [string]$ServerIp = "192.168.1.60",
    [switch]$SkipImageProbe
)

$ErrorActionPreference = "Stop"
$CaPath = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "runtime/certs/ca.crt"

function Invoke-MirrorCurl {
    param([string[]]$Arguments)

    $Output = & curl.exe --fail --silent --show-error --ssl-no-revoke --cacert $CaPath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Mirror request failed with curl exit code $LASTEXITCODE."
    }
    return $Output
}

foreach ($Port in 5001, 5002, 5003) {
    Invoke-MirrorCurl -Arguments @("https://${ServerIp}:${Port}/v2/") | Out-Null
    Write-Host "OCI cache port ${Port}: OK"
}

$ArtifactUrl = "https://${ServerIp}:8443/cache/get.k3s.io/"
Invoke-MirrorCurl -Arguments @("--head", $ArtifactUrl) | Out-Null
$Headers = Invoke-MirrorCurl -Arguments @("--head", $ArtifactUrl)
if (($Headers -join "`n") -notmatch "(?im)^X-LinDeploy-Cache:\s*HIT\s*$") {
    throw "Artifact cache did not return HIT on the repeated request."
}
Write-Host "Artifact cache MISS-to-HIT behavior: OK"

$ChannelUrl = "https://${ServerIp}:8443/cache/update.k3s.io/v1-release/channels/stable"
$ResolvedChannelUrl = (Invoke-MirrorCurl -Arguments @(
    "--location", "--output", "NUL", "--write-out", "%{url_effective}", $ChannelUrl
)) -join ""
$ResolvedK3sVersion = [Uri]::UnescapeDataString(($ResolvedChannelUrl.TrimEnd('/') -split '/')[-1])
if ($ResolvedK3sVersion -notmatch '^v\d+\.\d+\.\d+\+k3s\d+$') {
    throw "K3s stable channel resolved to invalid version '$ResolvedK3sVersion'."
}
Write-Host "K3s stable channel resolution: OK ($ResolvedK3sVersion)"

$KubernetesRpmBase = "https://${ServerIp}:8443/cache/pkgs.k8s.io/core:/stable:/v1.36/rpm"
foreach ($Path in "repodata/repomd.xml", "repodata/repomd.xml.key") {
    $Url = "$KubernetesRpmBase/$Path"
    Invoke-MirrorCurl -Arguments @("--head", $Url) | Out-Null
    $Headers = Invoke-MirrorCurl -Arguments @("--head", $Url)
    if (($Headers -join "`n") -notmatch "(?im)^X-LinDeploy-Cache:\s*HIT\s*$") {
        throw "Kubernetes RPM cache did not return HIT for $Path."
    }
}
Write-Host "Kubernetes RPM metadata and official GPG key cache: OK"

$SystemRepositoryProbes = [ordered]@{
    "CentOS Stream 9 BaseOS" = "mirror.stream.centos.org/9-stream/BaseOS/x86_64/os/repodata/repomd.xml"
    "Rocky Linux 9 BaseOS" = "dl.rockylinux.org/pub/rocky/9/BaseOS/x86_64/os/repodata/repomd.xml"
    "AlmaLinux 9 BaseOS" = "repo.almalinux.org/almalinux/9/BaseOS/x86_64/os/repodata/repomd.xml"
    "Ubuntu Jammy archive" = "archive.ubuntu.com/ubuntu/dists/jammy/InRelease"
    "Ubuntu Jammy security" = "security.ubuntu.com/ubuntu/dists/jammy-security/InRelease"
    "Debian Bookworm archive" = "deb.debian.org/debian/dists/bookworm/InRelease"
    "Debian Bookworm security" = "security.debian.org/debian-security/dists/bookworm-security/InRelease"
    "Docker CentOS 9" = "download.docker.com/linux/centos/9/x86_64/stable/repodata/repomd.xml"
    "Docker Ubuntu Jammy" = "download.docker.com/linux/ubuntu/dists/jammy/InRelease"
}

foreach ($Probe in $SystemRepositoryProbes.GetEnumerator()) {
    $Url = "https://${ServerIp}:8443/cache/$($Probe.Value)"
    Invoke-MirrorCurl -Arguments @("--head", "--max-time", "180", $Url) | Out-Null
    $Headers = Invoke-MirrorCurl -Arguments @("--head", "--max-time", "30", $Url)
    if (($Headers -join "`n") -notmatch "(?im)^X-LinDeploy-Cache:\s*(HIT|REFRESH|STALE)\s*$") {
        throw "System repository cache did not return a valid cache state for $($Probe.Key)."
    }
    Write-Host "$($Probe.Key) cache: OK"
}

if (-not $SkipImageProbe) {
    $ImageUrl = "https://${ServerIp}:5001/v2/pause/manifests/3.10.1"
    Invoke-MirrorCurl -Arguments @(
        "--max-time", "600",
        "--header", "Accept: application/vnd.oci.image.index.v1+json",
        $ImageUrl
    ) | Out-Null

    $Stopwatch = [Diagnostics.Stopwatch]::StartNew()
    Invoke-MirrorCurl -Arguments @(
        "--max-time", "10",
        "--header", "Accept: application/vnd.oci.image.index.v1+json",
        $ImageUrl
    ) | Out-Null
    $Stopwatch.Stop()
    if ($Stopwatch.Elapsed.TotalSeconds -gt 5) {
        throw "Repeated OCI image request did not use the local cache quickly enough."
    }
    Write-Host "OCI pull-through MISS-to-local behavior: OK ($([math]::Round($Stopwatch.Elapsed.TotalMilliseconds)) ms cached)"
}
