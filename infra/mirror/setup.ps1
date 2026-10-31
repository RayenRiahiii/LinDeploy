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

    # 1. Try WSL if available
    $hasWsl = Get-Command wsl.exe -ErrorAction SilentlyContinue
    if ($hasWsl) {
        try {
            $WslRoot = (wsl.exe wslpath -a ($MirrorRoot -replace '\\', '/')).Trim()
            if ($WslRoot) {
                & wsl.exe bash -lc "set -e; cd '$WslRoot'; $Command"
                if ($LASTEXITCODE -eq 0) { return }
            }
        } catch {
            # continue to docker fallback
        }
    }

    # 2. Fallback: Use Docker (guaranteed to be available for LinDeploy)
    Write-Host "      Using Docker container to generate TLS certificates..." -ForegroundColor Cyan
    docker run --rm -v "${MirrorRoot}:/mirror" -w /mirror nginx:1.28-alpine sh -c "set -e; $Command"
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to generate mirror TLS certificates via Docker."
    }
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
