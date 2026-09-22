# ============================================================
#  LinDeploy - Stop all services
#  Run: .\stop-lindeploy.ps1
# ============================================================

Write-Host ""
Write-Host "Stopping LinDeploy services..." -ForegroundColor Yellow

# Kill Celery processes
Get-Process | Where-Object { $_.MainWindowTitle -like "*celery*" } | Stop-Process -Force -ErrorAction SilentlyContinue

# Kill Python (Django runserver) - be careful not to kill other pythons
# Only kills python processes launched from this project's .venv
$venvPython = "C:\Users\riahi\LinDeploy\backend\.venv\Scripts\python.exe"
Get-Process python -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $venvPython } | Stop-Process -Force -ErrorAction SilentlyContinue

# Kill Node / Vite
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# Stop Redis in WSL
wsl -d Ubuntu -- bash -c "sudo service redis-server stop" 2>&1 | Out-Null

Write-Host "All LinDeploy services stopped." -ForegroundColor Green
Write-Host ""

