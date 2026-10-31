# ============================================================
#  LinDeploy - One-click dev startup script
#  Run this from: C:\Users\riahi\LinDeploy\
#  Usage: .\start-lindeploy.ps1
# ============================================================

$Root   = $PSScriptRoot
$Back   = Join-Path $Root "backend"
$Front  = Join-Path $Root "frontend"
$Venv   = Join-Path $Back ".venv\Scripts\Activate.ps1"
$Python = Join-Path $Back ".venv\Scripts\python.exe"
$Celery = Join-Path $Back ".venv\Scripts\celery.exe"
$Npm    = "C:\Program Files\nodejs\npm.cmd"

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  LinDeploy - Starting all services        " -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# ── 1. Check / Start Redis ─────────────────────────────────────
Write-Host "[1/5] Checking Redis service..." -ForegroundColor Yellow
$redisCheck = & $Python -c "import socket; s = socket.socket(); s.settimeout(1); err = s.connect_ex(('127.0.0.1', 6379)); s.sendall(b'PING\r\n') if err == 0 else None; print('PONG' if err == 0 and b'PONG' in s.recv(1024) else 'FAIL')" 2>&1
if ($redisCheck -match "PONG") {
    Write-Host "      Redis is already UP (PONG)" -ForegroundColor Green
} else {
    Write-Host "      Attempting to start Redis container..." -ForegroundColor Yellow
    docker start Redis-django 2>&1 | Out-Null
    Start-Sleep -Seconds 1
    $redisCheck = & $Python -c "import socket; s = socket.socket(); s.settimeout(1); err = s.connect_ex(('127.0.0.1', 6379)); s.sendall(b'PING\r\n') if err == 0 else None; print('PONG' if err == 0 and b'PONG' in s.recv(1024) else 'FAIL')" 2>&1
    if ($redisCheck -match "PONG") {
        Write-Host "      Redis container started successfully (PONG)" -ForegroundColor Green
    } else {
        wsl -d Ubuntu -- bash -c "sudo service redis-server start" 2>&1 | Out-Null
        $redisPong = wsl -d Ubuntu -- bash -c "redis-cli ping" 2>&1
        if ($redisPong -match "PONG") {
            Write-Host "      Redis is UP in WSL (PONG)" -ForegroundColor Green
        } else {
            Write-Host "      WARNING: Redis is not responding on port 6379." -ForegroundColor Red
            Write-Host "      Run: docker start Redis-django" -ForegroundColor Yellow
        }
    }
}
Write-Host ""

# ── 2. Run Django migrations ───────────────────────────────
Write-Host "[2/5] Running Django migrations..." -ForegroundColor Yellow
& $Python (Join-Path $Back "manage.py") migrate 2>&1 | ForEach-Object { "      $_" }
Write-Host "      Migrations done." -ForegroundColor Green
Write-Host ""

# ── 3. Open Django dev server in a new terminal ────────────
Write-Host "[3/5] Launching Django dev server (http://127.0.0.1:8000)..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "Set-Location '$Back'; & '$Venv'; python manage.py runserver"
)
Start-Sleep -Seconds 2
Write-Host "      Django terminal launched." -ForegroundColor Green
Write-Host ""

# ── 4. Open Celery worker in a new terminal ────────────────
Write-Host "[4/5] Launching Celery worker..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "Set-Location '$Back'; & '$Venv'; celery -A backend worker --loglevel=info --pool=solo"
)
Start-Sleep -Seconds 1
Write-Host "      Celery worker terminal launched." -ForegroundColor Green
Write-Host ""

# ── 5. Open frontend dev server in a new terminal ─────────
Write-Host "[5/5] Launching Vite frontend (http://localhost:5173)..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "Set-Location '$Front'; & '$Npm' run dev"
)
Start-Sleep -Seconds 1
Write-Host "      Frontend terminal launched." -ForegroundColor Green
Write-Host ""

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  All services started!" -ForegroundColor Green
Write-Host ""
Write-Host "  Frontend  -> http://localhost:5173" -ForegroundColor White
Write-Host "  Django API -> http://127.0.0.1:8000/api/" -ForegroundColor White
Write-Host ""
Write-Host "  NOTE: Celery Beat (scheduler) is NOT started" -ForegroundColor DarkYellow
Write-Host "  by this script. Start it manually if needed:" -ForegroundColor DarkYellow
Write-Host "  cd backend; .\.venv\Scripts\Activate.ps1" -ForegroundColor DarkYellow
Write-Host "  celery -A backend beat --loglevel=info" -ForegroundColor DarkYellow
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

