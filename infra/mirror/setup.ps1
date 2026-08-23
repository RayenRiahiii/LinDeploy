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

$WslRoot = (wsl.exe wslpath -a ($MirrorRoot -replace '\\', '/')).Trim()
if (-not $WslRoot) {
    throw "Unable to translate the mirror directory to a WSL path."
}

$CaKey = Join-Path $CertDir "ca.key"
$CaCertificate = Join-Path $CertDir "ca.crt"
if ($RotateCa -or -not (Test-Path -LiteralPath $CaKey) -or -not (Test-Path -LiteralPath $CaCertificate)) {
    wsl.exe bash -lc "set -e; cd '$WslRoot'; openssl req -x509 -newkey rsa:3072 -sha256 -nodes -days 3650 -config runtime/openssl.cnf -keyout runtime/certs/ca.key -out runtime/certs/ca.crt"
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

wsl.exe bash -lc "set -e; cd '$WslRoot'; openssl req -new -newkey rsa:3072 -nodes -config runtime/openssl.cnf -keyout runtime/certs/mirror.key -out runtime/certs/mirror.csr; openssl x509 -req -sha256 -days 825 -in runtime/certs/mirror.csr -CA runtime/certs/ca.crt -CAkey runtime/certs/ca.key -CAcreateserial -extensions server_ext -extfile runtime/openssl.cnf -out runtime/certs/mirror.crt; chmod 600 runtime/certs/*.key"

$MirrorEnv = Join-Path $MirrorRoot ".env"
if (-not (Test-Path -LiteralPath $MirrorEnv)) {
    Copy-Item (Join-Path $MirrorRoot ".env.example") $MirrorEnv
}

Write-Host "Mirror certificates created for $DnsName and $ServerIp."
Write-Host "CA certificate: $(Join-Path $CertDir 'ca.crt')"
Write-Host "Run .\start.ps1 from this directory to start the mirror."
