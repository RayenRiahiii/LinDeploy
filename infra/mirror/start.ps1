$ErrorActionPreference = "Stop"
$MirrorRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $MirrorRoot

if (-not (Test-Path "runtime/certs/mirror.crt")) {
    throw "Mirror certificate not found. Run .\setup.ps1 first."
}

docker compose up -d --build
docker compose ps
