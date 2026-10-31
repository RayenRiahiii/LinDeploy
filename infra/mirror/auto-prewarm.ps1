param(
    [string]$ServerIp = "",
    [string]$KubernetesMinor = "v1.36",
    [string]$CalicoVersion = "v3.32.0",
    [string]$K3sChannel = "stable",
    [ValidateSet("amd64", "arm64")]
    [string]$Architecture = "amd64",
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$MirrorRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MirrorRoot)
$BackendEnv = Join-Path $ProjectRoot "backend\.env"
$StatePath = Join-Path $MirrorRoot "runtime\prewarm-state.json"
$CaPath = Join-Path $MirrorRoot "runtime\certs\ca.crt"
$PrewarmProfile = "verified-assets-v3"

function Get-ServerIpFromBackend {
    if (-not (Test-Path -LiteralPath $BackendEnv)) {
        return ""
    }
    $line = Get-Content -LiteralPath $BackendEnv |
        Where-Object { $_ -match '^LINDEPLOY_PACKAGE_MIRROR_BASE_URL=' } |
        Select-Object -First 1
    if (-not $line) {
        return ""
    }
    $value = ($line -split '=', 2)[1].Trim()
    try {
        return ([Uri]$value).Host
    }
    catch {
        return ""
    }
}

function Invoke-MirrorCurl {
    param([Parameter(Mandatory)][string[]]$Arguments)

    $output = & curl.exe --fail --silent --show-error --retry 3 --retry-all-errors --retry-delay 2 --ssl-no-revoke --cacert $CaPath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Mirror request failed with curl exit code $LASTEXITCODE."
    }
    return $output
}

function Get-PreviousComponentState {
    param([string]$Name)

    if (-not (Test-Path -LiteralPath $StatePath)) {
        return $null
    }
    try {
        $state = Get-Content -Raw -LiteralPath $StatePath | ConvertFrom-Json
        $component = $state.components.$Name
        if ($component -is [Array]) {
            $component = $component |
                Where-Object { $_ -is [PSCustomObject] -and $_.status } |
                Select-Object -Last 1
        }
        return $component
    }
    catch {
        return $null
    }
}

function New-ComponentState {
    param(
        [string]$Status,
        [string]$ActiveVersion,
        [string]$AvailableVersion,
        [string]$LastCheckedAt,
        [string]$LastPrewarmAt,
        [string]$ErrorMessage,
        [string]$ManifestPath = "",
        [string]$ManifestSha256 = ""
    )

    return [ordered]@{
        profile = $PrewarmProfile
        status = $Status
        active_version = $ActiveVersion
        available_version = $AvailableVersion
        last_checked_at = $LastCheckedAt
        last_prewarm_at = $LastPrewarmAt
        manifest_path = $ManifestPath
        manifest_sha256 = $ManifestSha256
        error = $ErrorMessage
    }
}

function Write-PrewarmState {
    param($KubernetesState, $K3sState)

    $directory = Split-Path -Parent $StatePath
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
    $temporaryPath = "$StatePath.tmp"
    [ordered]@{
        updated_at = [DateTime]::UtcNow.ToString("o")
        components = [ordered]@{
            kubernetes = $KubernetesState
            k3s = $K3sState
        }
    } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $temporaryPath -Encoding UTF8
    Move-Item -Force -LiteralPath $temporaryPath -Destination $StatePath
}

function Invoke-ComponentPrewarm {
    param(
        [string]$Name,
        [string]$Version,
        $PreviousState,
        [scriptblock]$PersistRunningState
    )

    $now = [DateTime]::UtcNow.ToString("o")
    $previousActive = if ($PreviousState) { [string]$PreviousState.active_version } else { "" }
    $previousPrewarm = if ($PreviousState) { [string]$PreviousState.last_prewarm_at } else { "" }
    $previousProfile = if ($PreviousState -and $PreviousState.profile) { [string]$PreviousState.profile } else { "" }
    $safeVersion = $Version -replace '[^A-Za-z0-9._+-]', '_'
    $manifestPath = Join-Path $MirrorRoot "runtime\manifests\$($Name.ToLowerInvariant())-$safeVersion-$Architecture.json"
    $previousManifestSha256 = if ($PreviousState -and $PreviousState.manifest_sha256) { [string]$PreviousState.manifest_sha256 } else { "" }
    $manifestIsValid = $false
    if (Test-Path -LiteralPath $manifestPath) {
        try {
            $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
            $actualManifestSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $manifestPath).Hash.ToLowerInvariant()
            $manifestIsValid = (
                $manifest.schema_version -eq 1 -and
                [string]$manifest.component -eq $Name.ToLowerInvariant() -and
                [string]$manifest.version -eq $Version -and
                [string]$manifest.architecture -eq $Architecture -and
                [int]$manifest.asset_count -gt 0 -and
                $actualManifestSha256 -eq $previousManifestSha256
            )
        }
        catch {
            $manifestIsValid = $false
        }
    }
    if (
        -not $Force -and
        $previousActive -eq $Version -and
        $previousProfile -eq $PrewarmProfile -and
        -not [string]::IsNullOrWhiteSpace($previousPrewarm) -and
        $manifestIsValid
    ) {
        Write-Host "$Name $Version is already ready; no download required."
        return New-ComponentState "ready" $previousActive $Version $now $previousPrewarm "" $manifestPath $actualManifestSha256
    }

    & $PersistRunningState (New-ComponentState "running" $previousActive $Version $now $previousPrewarm "")
    try {
        $prewarmOutput = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $MirrorRoot "prewarm.ps1") `
            -ServerIp $ServerIp -Component $Name -Version $Version `
            -CalicoVersion $CalicoVersion -Architecture $Architecture 2>&1
        $prewarmExitCode = $LASTEXITCODE
        $prewarmOutput | ForEach-Object { Write-Host $_ }
        if ($prewarmExitCode -ne 0) {
            throw "$Name prewarm exited with code $prewarmExitCode."
        }
        if (-not (Test-Path -LiteralPath $manifestPath)) {
            throw "$Name prewarm completed without the required asset manifest $manifestPath."
        }
        $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
        if (
            $manifest.schema_version -ne 1 -or
            [string]$manifest.component -ne $Name.ToLowerInvariant() -or
            [string]$manifest.version -ne $Version -or
            [int]$manifest.asset_count -le 0
        ) {
            throw "$Name produced an invalid or empty asset manifest."
        }
        $manifestSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $manifestPath).Hash.ToLowerInvariant()
        return New-ComponentState "ready" $Version $Version $now ([DateTime]::UtcNow.ToString("o")) "" $manifestPath $manifestSha256
    }
    catch {
        return New-ComponentState "failed" $previousActive $Version $now $previousPrewarm $_.Exception.Message
    }
}

if (-not $ServerIp) {
    $ServerIp = Get-ServerIpFromBackend
}
if (-not $ServerIp) {
    throw "Mirror server address is unavailable. Run sync-network.ps1 or pass -ServerIp."
}
if (-not (Test-Path -LiteralPath $CaPath)) {
    throw "Mirror CA certificate not found at $CaPath. Run setup.ps1 first."
}
if ($KubernetesMinor -notmatch '^v\d+\.\d+$') {
    throw "Invalid Kubernetes minor '$KubernetesMinor'. Expected format: v1.36."
}

$cacheBase = "https://${ServerIp}:8443/cache"
$stableSuffix = $KubernetesMinor.TrimStart('v')
$kubernetesVersion = ((Invoke-MirrorCurl -Arguments @(
    "--location", "--max-time", "120",
    "$cacheBase/dl.k8s.io/release/stable-$stableSuffix.txt"
)) -join "").Trim()
if ($kubernetesVersion -notmatch '^v\d+\.\d+\.\d+$') {
    throw "Kubernetes stable endpoint returned invalid version '$kubernetesVersion'."
}

$k3sChannelUrl = "$cacheBase/update.k3s.io/v1-release/channels/$K3sChannel"
$effectiveK3sUrl = ((Invoke-MirrorCurl -Arguments @(
    "--location", "--output", "NUL", "--max-time", "120",
    "--write-out", "%{url_effective}", $k3sChannelUrl
)) -join "").Trim()
$k3sVersion = [Uri]::UnescapeDataString(($effectiveK3sUrl.TrimEnd('/') -split '/')[-1])
if ($k3sVersion -notmatch '^v\d+\.\d+\.\d+\+k3s\d+$') {
    throw "K3s channel '$K3sChannel' returned invalid version '$k3sVersion'."
}

$previousKubernetes = Get-PreviousComponentState "kubernetes"
$previousK3s = Get-PreviousComponentState "k3s"
$kubernetesState = New-ComponentState "checking" `
    $(if ($previousKubernetes) { [string]$previousKubernetes.active_version } else { "" }) `
    $kubernetesVersion ([DateTime]::UtcNow.ToString("o")) `
    $(if ($previousKubernetes) { [string]$previousKubernetes.last_prewarm_at } else { "" }) ""
$k3sState = New-ComponentState "checking" `
    $(if ($previousK3s) { [string]$previousK3s.active_version } else { "" }) `
    $k3sVersion ([DateTime]::UtcNow.ToString("o")) `
    $(if ($previousK3s) { [string]$previousK3s.last_prewarm_at } else { "" }) ""
Write-PrewarmState $kubernetesState $k3sState

$kubernetesState = Invoke-ComponentPrewarm "Kubernetes" $kubernetesVersion $previousKubernetes {
    param($runningState)
    $script:kubernetesState = $runningState
    Write-PrewarmState $script:kubernetesState $script:k3sState
}
Write-PrewarmState $kubernetesState $k3sState

$k3sState = Invoke-ComponentPrewarm "K3s" $k3sVersion $previousK3s {
    param($runningState)
    $script:k3sState = $runningState
    Write-PrewarmState $script:kubernetesState $script:k3sState
}
Write-PrewarmState $kubernetesState $k3sState

if ($kubernetesState.status -eq "failed" -or $k3sState.status -eq "failed") {
    throw "One or more mirror components failed to prewarm. Review $StatePath."
}

Write-Host "Automatic prewarm complete: Kubernetes $kubernetesVersion; K3s $k3sVersion."
