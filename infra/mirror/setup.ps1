param(
    [string]$ServerIp = "192.168.1.60",
    [string]$DnsName = "lindeploy-mirror.local",
    [switch]$RotateCa
)

$ErrorActionPreference = "Stop"
$MirrorRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RuntimeDir = Join-Path $MirrorRoot "runtime"
$CertDir = Join-Path $RuntimeDir "certs"
$OpenSslConfig = Join-Path $RuntimeDir "openssl.cnf"

New-Item -ItemType Directory -Force -Path $CertDir | Out-Null

@"
[req]
distinguished_name = subject
x509_extensions = v3_ca
prompt = no

[subject]
CN = LinDeploy Local Mirror CA
O = LinDeploy

[v3_ca]
basicConstraints = critical,CA:TRUE
keyUsage = critical,keyCertSign,cRLSign
subjectKeyIdentifier = hash
"@ | Set-Content -Encoding ascii $OpenSslConfig

function Invoke-MirrorOpenSsl {
    param([Parameter(Mandatory)][string]$Command)

    # 1. Try Git Bash or sh (native Windows, included with Git, fastest and zero overhead)
    $GitBashCandidates = @()
    $gitCmd = Get-Command "git.exe" -ErrorAction SilentlyContinue
    if ($gitCmd -and $gitCmd.Source) {
        $gitDir = Split-Path (Split-Path $gitCmd.Source -Parent) -Parent
        $GitBashCandidates += (Join-Path $gitDir "bin\bash.exe")
        $GitBashCandidates += (Join-Path $gitDir "usr\bin\bash.exe")
        $GitBashCandidates += (Join-Path $gitDir "bin\sh.exe")
    }
    $bashCmd = Get-Command "bash.exe" -ErrorAction SilentlyContinue
    if ($bashCmd -and $bashCmd.Source) { $GitBashCandidates += $bashCmd.Source }
    $shCmd = Get-Command "sh.exe" -ErrorAction SilentlyContinue
    if ($shCmd -and $shCmd.Source) { $GitBashCandidates += $shCmd.Source }

    $GitBashCandidates += @(
        "C:\Program Files\Git\bin\bash.exe",
        "C:\Program Files\Git\usr\bin\bash.exe",
        "C:\Program Files (x86)\Git\bin\bash.exe",
        "C:\Program Files (x86)\Git\usr\bin\bash.exe"
    )
    if ($env:ProgramFiles) { $GitBashCandidates += (Join-Path $env:ProgramFiles "Git\bin\bash.exe") }
    if (${env:ProgramFiles(x86)}) { $GitBashCandidates += (Join-Path ${env:ProgramFiles(x86)} "Git\bin\bash.exe") }
    if ($env:LOCALAPPDATA) { $GitBashCandidates += (Join-Path $env:LOCALAPPDATA "Programs\Git\bin\bash.exe") }

    $GitBash = $GitBashCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
    if ($GitBash) {
        $prevMsys = $env:MSYS_NO_PATHCONV
        try {
            $env:MSYS_NO_PATHCONV = "1"
            $PosixRoot = ($MirrorRoot -replace '\\', '/')
            & $GitBash -c "set -e; cd '$PosixRoot'; $Command"
            if ($LASTEXITCODE -eq 0) { return }
        } catch {
            # continue to next fallback
        } finally {
            if ($prevMsys) { $env:MSYS_NO_PATHCONV = $prevMsys } else { Remove-Item env:MSYS_NO_PATHCONV -ErrorAction SilentlyContinue }
        }
    }

    # 2. Try WSL if available and functional (test openssl presence without crashing or showing error)
    $hasWsl = Get-Command "wsl.exe" -ErrorAction SilentlyContinue
    if ($hasWsl) {
        try {
            $null = & wsl.exe sh -c "command -v openssl" 2>$null
            if ($LASTEXITCODE -eq 0) {
                $WslRoot = (& wsl.exe wslpath -a ($MirrorRoot -replace '\\', '/') 2>$null)
                if ($WslRoot) {
                    $WslRoot = $WslRoot.Trim()
                    & wsl.exe sh -c "set -e; cd '$WslRoot'; $Command" 2>$null
                    if ($LASTEXITCODE -eq 0) { return }
                }
            }
        } catch {
            # continue to docker fallback
        }
    }

    # 3. Fallback: Use Docker (guaranteed to be available for LinDeploy)
    Write-Host "      Using Docker container to generate TLS certificates..." -ForegroundColor Cyan

    # 3a. Try python:3.12-slim-bookworm (pre-installed OpenSSL 3.x, cached with backend build)
    try {
        & docker run --rm -v "${MirrorRoot}:/mirror" -w /mirror python:3.12-slim-bookworm sh -c "set -e; $Command"
        if ($LASTEXITCODE -eq 0) { return }
    } catch {
        # continue to alpine fallback
    }

    # 3b. Try nginx:1.28-alpine with on-the-fly openssl installation
    try {
        & docker run --rm -v "${MirrorRoot}:/mirror" -w /mirror nginx:1.28-alpine sh -c "apk add --no-cache openssl >/dev/null 2>&1; set -e; $Command"
        if ($LASTEXITCODE -eq 0) { return }
    } catch {
        # continue to throw
    }

    throw "Failed to generate mirror TLS certificates via Git Bash, WSL, or Docker."
}

$CaKey = Join-Path $CertDir "ca.key"
$CaCertificate = Join-Path $CertDir "ca.crt"
if ($RotateCa -or -not (Test-Path -LiteralPath $CaKey) -or -not (Test-Path -LiteralPath $CaCertificate)) {
    Invoke-MirrorOpenSsl "openssl req -x509 -newkey rsa:3072 -sha256 -nodes -days 3650 -config runtime/openssl.cnf -keyout runtime/certs/ca.key -out runtime/certs/ca.crt"
    Write-Host "Created a new LinDeploy mirror CA."
}
else {
    Write-Host "Reusing the existing LinDeploy mirror CA."
}

@"
[req]
distinguished_name = subject
req_extensions = server_ext
prompt = no

[subject]
CN = $DnsName
O = LinDeploy

[server_ext]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = $DnsName
IP.1 = $ServerIp
"@ | Set-Content -Encoding ascii $OpenSslConfig

Invoke-MirrorOpenSsl "openssl req -new -newkey rsa:3072 -nodes -config runtime/openssl.cnf -keyout runtime/certs/mirror.key -out runtime/certs/mirror.csr; openssl x509 -req -sha256 -days 825 -in runtime/certs/mirror.csr -CA runtime/certs/ca.crt -CAkey runtime/certs/ca.key -CAcreateserial -extensions server_ext -extfile runtime/openssl.cnf -out runtime/certs/mirror.crt; chmod 600 runtime/certs/*.key 2>/dev/null || true"

$MirrorEnv = Join-Path $MirrorRoot ".env"
if (-not (Test-Path -LiteralPath $MirrorEnv)) {
    Copy-Item (Join-Path $MirrorRoot ".env.example") $MirrorEnv
}

Write-Host "Mirror certificates created for $DnsName and $ServerIp."
Write-Host "CA certificate: $(Join-Path $CertDir 'ca.crt')"
Write-Host "Run .\start.ps1 from this directory to start the mirror."
