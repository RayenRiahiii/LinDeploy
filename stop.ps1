param(
    [switch]$CleanVolumes,
    [switch]$Help
)

if ($Help) {
    Write-Host "Usage: .\stop.ps1 [-CleanVolumes]"
    Write-Host "Stops and removes all running LinDeploy containers."
    exit 0
}

$ErrorActionPreference = "Stop"

Write-Host "Stopping LinDeploy containers..." -ForegroundColor Yellow

if ($CleanVolumes) {
    docker compose --env-file .env.docker down -v
    Write-Host "All LinDeploy containers and volumes removed." -ForegroundColor Green
} else {
    docker compose --env-file .env.docker down
    Write-Host "All LinDeploy containers stopped. (Data volumes preserved in data/ and Docker volumes)" -ForegroundColor Green
}

