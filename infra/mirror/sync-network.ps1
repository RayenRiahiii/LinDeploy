param(
    [string]$ServerIp,
    [string]$DnsName = "lindeploy-mirror.local",
    [switch]$SkipFirewall,
    [switch]$SkipBackendRestart
)

$ErrorActionPreference = "Stop"
$MirrorRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MirrorRoot)
$BackendRoot = Join-Path $ProjectRoot "backend"
$BackendEnv = Join-Path $BackendRoot ".env"
$RuntimeLogs = Join-Path $ProjectRoot "runtime-logs"

function Get-ActiveLanAddress {
    $Routes = Get-NetRoute -DestinationPrefix "0.0.0.0/0" -ErrorAction Stop |
        Where-Object { $_.State -eq "Alive" -and $_.NextHop -ne "0.0.0.0" } |
        Sort-Object RouteMetric, InterfaceMetric

    foreach ($Route in $Routes) {
        $Address = Get-NetIPAddress `
            -InterfaceIndex $Route.InterfaceIndex `
            -AddressFamily IPv4 `
            -ErrorAction SilentlyContinue |
            Where-Object {
                $_.IPAddress -notlike "169.254.*" -and
                $_.IPAddress -ne "127.0.0.1"
            } |
            Select-Object -First 1
        if ($Address) {
            return $Address
        }
    }
    throw "No usable IPv4 address was found on the active default-route interface."
}

function Get-NetworkCidr {
    param(
        [Parameter(Mandatory)][string]$IpAddress,
        [Parameter(Mandatory)][int]$PrefixLength
    )

    $Bytes = [Net.IPAddress]::Parse($IpAddress).GetAddressBytes()
    $Mask = [uint32]0
    if ($PrefixLength -gt 0) {
        $Mask = [uint32]::MaxValue -shl (32 - $PrefixLength)
    }
    $Value = ([uint32]$Bytes[0] -shl 24) -bor
        ([uint32]$Bytes[1] -shl 16) -bor
        ([uint32]$Bytes[2] -shl 8) -bor
        [uint32]$Bytes[3]
    $Network = $Value -band $Mask
    $NetworkIp = "{0}.{1}.{2}.{3}" -f `
        (($Network -shr 24) -band 255),
        (($Network -shr 16) -band 255),
        (($Network -shr 8) -band 255),
        ($Network -band 255)
    return "$NetworkIp/$PrefixLength"
}

function Set-DotEnvValue {
    param(
        [System.Collections.Generic.List[string]]$Lines,
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$Value
    )

    $Prefix = "$Name="
    for ($Index = 0; $Index -lt $Lines.Count; $Index++) {
        if ($Lines[$Index].StartsWith($Prefix, [StringComparison]::Ordinal)) {
            $Lines[$Index] = "$Prefix$Value"
            return
        }
    }
    $Lines.Add("$Prefix$Value")
}

function Restart-LinDeployBackend {
    New-Item -ItemType Directory -Force -Path $RuntimeLogs | Out-Null
    $PythonPath = Join-Path $BackendRoot ".venv\Scripts\python.exe"
    if (-not (Test-Path -LiteralPath $PythonPath)) {
        throw "Backend virtual environment not found at $PythonPath."
    }

    if (-not (Get-NetTCPConnection -LocalPort 6379 -State Listen -ErrorAction SilentlyContinue)) {
        $RedisContainer = (& docker ps -a --filter "name=^/django-redis$" --format "{{.Names}}") -join ""
        if ($RedisContainer -eq "django-redis") {
            docker start django-redis | Out-Null
        }
        for ($Attempt = 1; $Attempt -le 15; $Attempt++) {
            Start-Sleep -Seconds 1
            if (Get-NetTCPConnection -LocalPort 6379 -State Listen -ErrorAction SilentlyContinue) {
                break
            }
        }
    }
    if (-not (Get-NetTCPConnection -LocalPort 6379 -State Listen -ErrorAction SilentlyContinue)) {
        throw "Redis is not listening on localhost:6379; Celery cannot be restarted."
    }

    $Processes = Get-CimInstance Win32_Process | Where-Object {
        (
            ($_.Name -eq "python.exe" -and $_.ExecutablePath -eq $PythonPath) -or
            ($_.Name -eq "celery.exe" -and $_.ExecutablePath -like "$VenvPath*")
        ) -and
        ($_.CommandLine -match "manage.py runserver" -or $_.CommandLine -match "(?:-m )?celery")
    }
    foreach ($Process in $Processes) {
        # The Windows venv launcher creates child Python processes. Terminate
        # the complete tree so an older API or worker cannot survive a restart.
        & taskkill.exe /PID $Process.ProcessId /T /F 2>$null | Out-Null
    }
    Start-Sleep -Seconds 2

    Start-Process `
        -FilePath $PythonPath `
        -ArgumentList @("manage.py", "runserver", "127.0.0.1:8000", "--noreload") `
        -WorkingDirectory $BackendRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $RuntimeLogs "django.out.log") `
        -RedirectStandardError (Join-Path $RuntimeLogs "django.err.log")
    Start-Process `
        -FilePath $PythonPath `
        -ArgumentList @("-m", "celery", "-A", "backend", "worker", "--loglevel=info", "--pool=solo") `
        -WorkingDirectory $BackendRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $RuntimeLogs "celery.out.log") `
        -RedirectStandardError (Join-Path $RuntimeLogs "celery.err.log")
    Start-Process `
        -FilePath $PythonPath `
        -ArgumentList @("-m", "celery", "-A", "backend", "beat", "--loglevel=info") `
        -WorkingDirectory $BackendRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $RuntimeLogs "celery-beat.out.log") `
        -RedirectStandardError (Join-Path $RuntimeLogs "celery-beat.err.log")

    Start-Sleep -Seconds 5
    if (-not (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue)) {
        throw "Django did not start on 127.0.0.1:8000. Check runtime-logs/django.err.log."
    }

    # Queue a non-blocking initial check. The task skips components whose stable
    # version is already ready; Celery Beat repeats this check every 24 hours.
    & $PythonPath -m celery -A backend call auto_K8S.tasks.run_mirror_prewarm_task | Out-Null
}

function Wait-DockerEngine {
    & $env:ComSpec /d /c "docker info >nul 2>&1"
    if ($LASTEXITCODE -eq 0) {
        return
    }

    $DockerDesktop = Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
    if (-not (Test-Path -LiteralPath $DockerDesktop)) {
        throw "Docker Desktop is not running and was not found at $DockerDesktop."
    }
    Write-Host "Starting Docker Desktop..."
    Start-Process -FilePath $DockerDesktop | Out-Null

    for ($Attempt = 1; $Attempt -le 60; $Attempt++) {
        Start-Sleep -Seconds 2
        & $env:ComSpec /d /c "docker info >nul 2>&1"
        if ($LASTEXITCODE -eq 0) {
            Write-Host "Docker engine is ready."
            return
        }
    }
    throw "Docker Desktop did not become ready within 120 seconds."
}

$DetectedAddress = Get-ActiveLanAddress
if (-not $ServerIp) {
    $ServerIp = $DetectedAddress.IPAddress
    $PrefixLength = $DetectedAddress.PrefixLength
}
else {
    $ConfiguredAddress = Get-NetIPAddress -IPAddress $ServerIp -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if (-not $ConfiguredAddress) {
        throw "Requested mirror IP $ServerIp is not assigned to this Windows server."
    }
    $PrefixLength = $ConfiguredAddress.PrefixLength
}
$LanSubnet = Get-NetworkCidr -IpAddress $ServerIp -PrefixLength $PrefixLength

Write-Host "Detected LinDeploy mirror address: $ServerIp/$PrefixLength"
Write-Host "Detected LAN subnet: $LanSubnet"

& (Join-Path $MirrorRoot "setup.ps1") -ServerIp $ServerIp -DnsName $DnsName
if (-not $SkipFirewall) {
    & (Join-Path $MirrorRoot "configure-firewall.ps1") -LanSubnet $LanSubnet
}
Wait-DockerEngine
& (Join-Path $MirrorRoot "start.ps1")
# The certificate is bind-mounted. Recreate/restart does not necessarily reload
# it when the gateway container already exists.
docker compose -f (Join-Path $MirrorRoot "compose.yaml") restart gateway | Out-Null
Start-Sleep -Seconds 2

if (-not (Test-Path -LiteralPath $BackendEnv)) {
    throw "Backend environment file not found at $BackendEnv."
}
$EnvLines = [System.Collections.Generic.List[string]]::new()
Get-Content -LiteralPath $BackendEnv | ForEach-Object { $EnvLines.Add($_) }
$CacheBase = "https://${ServerIp}:8443/cache"

Set-DotEnvValue $EnvLines "LINDEPLOY_MIRROR_ENABLED" "True"
Set-DotEnvValue $EnvLines "LINDEPLOY_REGISTRY_MIRRORS_JSON" "{`"registry.k8s.io`":`"https://${ServerIp}:5001`",`"quay.io`":`"https://${ServerIp}:5002`",`"docker.io`":`"https://${ServerIp}:5003`"}"
Set-DotEnvValue $EnvLines "LINDEPLOY_MIRROR_CA_CERTIFICATE_FILE" (Join-Path $MirrorRoot "runtime\certs\ca.crt")
Set-DotEnvValue $EnvLines "LINDEPLOY_SYSTEM_PACKAGE_CACHE_ENABLED" "True"
Set-DotEnvValue $EnvLines "LINDEPLOY_PACKAGE_MIRROR_BASE_URL" "$CacheBase"
Set-DotEnvValue $EnvLines "LINDEPLOY_K3S_INSTALL_SCRIPT_URL" "$CacheBase/get.k3s.io/"
Set-DotEnvValue $EnvLines "LINDEPLOY_K3S_CHANNEL_URL" "$CacheBase/update.k3s.io/v1-release/channels"
Set-DotEnvValue $EnvLines "LINDEPLOY_K3S_ARTIFACT_URL" "$CacheBase/github.com/k3s-io/k3s/releases/download"
Set-DotEnvValue $EnvLines "LINDEPLOY_CALICO_MANIFEST_URL" "$CacheBase/raw.githubusercontent.com/projectcalico/calico/v3.32.0/manifests/calico.yaml"
Set-DotEnvValue $EnvLines "LINDEPLOY_KUBERNETES_RPM_BASEURL" "$CacheBase/pkgs.k8s.io/core:/stable:/v1.36/rpm/"
Set-DotEnvValue $EnvLines "LINDEPLOY_KUBERNETES_RPM_GPGKEY" "$CacheBase/pkgs.k8s.io/core:/stable:/v1.36/rpm/repodata/repomd.xml.key"
Set-DotEnvValue $EnvLines "LINDEPLOY_CONTAINERD_RPM_BASEURL" "$CacheBase/download.docker.com/linux/centos/9/`$basearch/stable"
Set-DotEnvValue $EnvLines "LINDEPLOY_CONTAINERD_RPM_GPGKEY" "$CacheBase/download.docker.com/linux/centos/gpg"
Set-DotEnvValue $EnvLines "LINDEPLOY_CONTAINERD_APT_REPO_URL" "$CacheBase/download.docker.com/linux/ubuntu"
Set-DotEnvValue $EnvLines "LINDEPLOY_CONTAINERD_APT_KEY_URL" "$CacheBase/download.docker.com/linux/ubuntu/gpg"
Set-DotEnvValue $EnvLines "LINDEPLOY_KUBERNETES_APT_REPO_URL" "$CacheBase/pkgs.k8s.io/core:/stable:/v1.36/deb/"
Set-DotEnvValue $EnvLines "LINDEPLOY_KUBERNETES_APT_KEY_URL" "$CacheBase/pkgs.k8s.io/core:/stable:/v1.36/deb/Release.key"

[IO.File]::WriteAllLines($BackendEnv, $EnvLines, [Text.UTF8Encoding]::new($false))
Write-Host "Updated backend mirror endpoints in $BackendEnv."

if (-not $SkipBackendRestart) {
    Restart-LinDeployBackend
    Write-Host "Django, Celery worker, and Celery Beat restarted."
}

& (Join-Path $MirrorRoot "test.ps1") -ServerIp $ServerIp -SkipImageProbe
Write-Host "LinDeploy mirror network synchronization completed successfully."
