param(
    [string]$HostIp,
    [int]$FrontendPort = 5173,
    [int]$BackendPort = 8000,
    [int]$RedisPort = 6379,
    [switch]$NoBuild,
    [switch]$Help
)

if ($Help) {
    Write-Host "Usage: .\start.ps1 [-HostIp <IP>] [-FrontendPort <port>] [-BackendPort <port>] [-NoBuild]"
    Write-Host "Auto-detects active LAN IP, configures mirror TLS, seeds database, and boots LinDeploy containers."
    exit 0
}

$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "             LinDeploy Container Launcher                 " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 0. Docker Daemon Verification & Auto-Start
Write-Host "[0/5] Checking Docker daemon status..." -ForegroundColor Yellow
$DockerCli = Get-Command "docker" -ErrorAction SilentlyContinue
if (-not $DockerCli) {
    Write-Host "`n[ERROR] Docker CLI was not found on your system." -ForegroundColor Red
    Write-Host "Please install Docker Desktop (https://www.docker.com/products/docker-desktop/) and ensure 'docker' is in your PATH." -ForegroundColor Yellow
    exit 1
}

$IsDockerRunning = $false
try {
    $null = & docker info --format '{{.ServerVersion}}' 2>$null
    if ($LASTEXITCODE -eq 0) {
        $IsDockerRunning = $true
    }
} catch {
    $IsDockerRunning = $false
}

if (-not $IsDockerRunning) {
    Write-Host "      Docker daemon is not responding. Attempting to start Docker Desktop..." -ForegroundColor Cyan
    $DesktopCandidates = @(
        (Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop\Docker Desktop.exe"),
        "C:\Program Files\Docker\Docker\Docker Desktop.exe",
        (Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe")
    )
    $DesktopExe = $DesktopCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

    if ($DesktopExe) {
        Start-Process -FilePath $DesktopExe
        Write-Host "      Waiting for Docker daemon to become ready (this may take up to 45 seconds)..." -ForegroundColor Yellow
        $TimeoutSeconds = 60
        $Elapsed = 0
        while ($Elapsed -lt $TimeoutSeconds) {
            Start-Sleep -Seconds 3
            $Elapsed += 3
            try {
                $null = & docker info --format '{{.ServerVersion}}' 2>$null
                if ($LASTEXITCODE -eq 0) {
                    $IsDockerRunning = $true
                    Write-Host "`n      Docker daemon is now ready!" -ForegroundColor Green
                    break
                }
            } catch {}
            Write-Host -NoNewline "."
        }
    }
}

if (-not $IsDockerRunning) {
    Write-Host "`n[ERROR] Unable to connect to Docker daemon." -ForegroundColor Red
    Write-Host "Please ensure Docker Desktop is open and shows 'Engine running', then re-run .\start.ps1" -ForegroundColor Yellow
    exit 1
}
Write-Host "      Docker daemon is active and healthy." -ForegroundColor Green

# 1. IP Detection
if ($HostIp) {
    $DetectedIp = $HostIp
    Write-Host "[1/5] Using specified host IP: $DetectedIp" -ForegroundColor Green
} else {
    Write-Host "[1/5] Detecting active host LAN IP..." -ForegroundColor Yellow
    $DetectedIp = "127.0.0.1"
    try {
        $Routes = Get-NetRoute -DestinationPrefix "0.0.0.0/0" -ErrorAction SilentlyContinue |
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
                $DetectedIp = $Address.IPAddress
                break
            }
        }
    } catch {
        Write-Warning "Could not detect active LAN route. Falling back to 127.0.0.1."
    }
    Write-Host "      Detected IP: $DetectedIp" -ForegroundColor Green
}

# 2. Database Volume Seeding
Write-Host "[2/5] Checking persistent database volume..." -ForegroundColor Yellow
$DataDir = Join-Path $ProjectRoot "data"
if (-not (Test-Path -LiteralPath $DataDir)) {
    New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
}
$DestDb = Join-Path $DataDir "db.sqlite3"
$SourceDb = Join-Path (Join-Path $ProjectRoot "backend") "db.sqlite3"
if ((-not (Test-Path -LiteralPath $DestDb)) -and (Test-Path -LiteralPath $SourceDb)) {
    Write-Host "      Seeding existing SQLite database to data/db.sqlite3..." -ForegroundColor Cyan
    Copy-Item $SourceDb $DestDb
}
$ManifestsDir = Join-Path (Join-Path (Join-Path $ProjectRoot "infra") "mirror") "runtime\manifests"
if (-not (Test-Path -LiteralPath $ManifestsDir)) {
    New-Item -ItemType Directory -Path $ManifestsDir -Force | Out-Null
}

# 3. Mirror TLS Certificate Check / Regeneration
Write-Host "[3/5] Verifying mirror TLS certificates for $DetectedIp..." -ForegroundColor Yellow
$MirrorCert = Join-Path (Join-Path (Join-Path $ProjectRoot "infra") "mirror") "runtime\certs\mirror.crt"
$NeedCertRegen = $true

if (Test-Path -LiteralPath $MirrorCert) {
    try {
        $Cert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($MirrorCert)
        $SanExt = $Cert.Extensions | Where-Object { $_.Oid.Value -eq "2.5.29.17" }
        $SanText = if ($SanExt) { $SanExt.Format($false) } else { "" }
        if ($SanText -and ($SanText -match [regex]::Escape($DetectedIp))) {
            $NeedCertRegen = $false
            Write-Host "      Certificates already valid for $DetectedIp." -ForegroundColor Green
        }
    } catch {
        $NeedCertRegen = $true
    }
}

if ($NeedCertRegen) {
    Write-Host "      Generating/updating TLS certificates for IP $DetectedIp..." -ForegroundColor Cyan
    $SetupScript = Join-Path (Join-Path (Join-Path $ProjectRoot "infra") "mirror") "setup.ps1"
    if (Test-Path -LiteralPath $SetupScript) {
        & $SetupScript -ServerIp $DetectedIp
    }
}

# 4. Generate .env.docker
Write-Host "[4/5] Updating .env.docker configuration..." -ForegroundColor Yellow
$EnvDockerPath = Join-Path $ProjectRoot ".env.docker"
$ExistingSecretKey = ""
if (Test-Path -LiteralPath $EnvDockerPath) {
    $matched = Get-Content -Path $EnvDockerPath | Where-Object { $_ -match '^DJANGO_SECRET_KEY=(.+)$' } | Select-Object -First 1
    if ($matched -and $matched -match '^DJANGO_SECRET_KEY=(.+)$') {
        $ExistingSecretKey = $Matches[1].Trim()
    }
}
if (-not $ExistingSecretKey) {
    $bytes = New-Object byte[] 40
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $ExistingSecretKey = [Convert]::ToBase64String($bytes).Replace('+', '-').Replace('/', '_').TrimEnd('=')
}

$EnvLines = @(
    "# Auto-generated by start.ps1 on $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')",
    "LINDEPLOY_HOST_IP=$DetectedIp",
    "FRONTEND_PORT=$FrontendPort",
    "BACKEND_PORT=$BackendPort",
    "REDIS_PORT=$RedisPort",
    "DJANGO_SECRET_KEY=$ExistingSecretKey",
    "DJANGO_DEBUG=False",
    "DJANGO_ALLOWED_HOSTS=*",
    "DJANGO_TIME_ZONE=UTC",
    "LINDEPLOY_MIRROR_ENABLED=True"
)
$EnvLines | Set-Content -Path $EnvDockerPath -Encoding utf8

# 5. Launch Docker Compose
Write-Host "[5/5] Starting Docker Compose services..." -ForegroundColor Yellow
$BuildFlag = if ($NoBuild) { "" } else { "--build" }

$ComposeArgs = @("compose", "--env-file", $EnvDockerPath, "up", "-d")
if (-not $NoBuild) {
    $ComposeArgs += "--build"
}
& docker @ComposeArgs
if ($LASTEXITCODE -ne 0) {
    Write-Host "`n[ERROR] Docker Compose failed to start services (Exit code: $LASTEXITCODE)." -ForegroundColor Red
    Write-Host "Please check the error output above for details." -ForegroundColor Yellow
    exit $LASTEXITCODE
}

Write-Host "`n==========================================================" -ForegroundColor Green
Write-Host "           LinDeploy is Running Successfully!             " -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "  Web Dashboard:     http://localhost:$FrontendPort" -ForegroundColor Cyan
if ($DetectedIp -ne "127.0.0.1") {
    Write-Host "  LAN Dashboard:     http://${DetectedIp}:$FrontendPort" -ForegroundColor Cyan
}
Write-Host "  Backend API:       http://localhost:$BackendPort/api/" -ForegroundColor Cyan
Write-Host "  Mirror Gateway:    https://${DetectedIp}:8443/cache/" -ForegroundColor Cyan
Write-Host "  Ansible Engine:    Native Linux container (no WSL needed)" -ForegroundColor Cyan
Write-Host "`nTo stop all services run:  .\stop.ps1" -ForegroundColor Gray
Write-Host "To view real-time logs:    docker compose logs -f" -ForegroundColor Gray

