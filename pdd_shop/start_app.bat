@echo off
setlocal
title PDD Shop Launcher v0.1.0
echo PDD Shop Launcher v0.1.0 / 2026-11-16
echo Started: %date% %time%
set "APP_DIR=%~dp0..\pdd-app"
if not exist "%APP_DIR%\package.json" (
  echo Project not found: %APP_DIR%
  pause
  exit /b 1
)
where npm.cmd >nul 2>&1
if errorlevel 1 (
  echo Node.js and npm are required. Install Node.js first.
  pause
  exit /b 1
)
if not exist "%APP_DIR%\node_modules\concurrently" (
  echo Dependencies are missing. Run npm install in %APP_DIR% first.
  pause
  exit /b 1
)
powershell -NoProfile -Command "if (Get-NetTCPConnection -State Listen -LocalPort 5173,3001 -ErrorAction SilentlyContinue) { Write-Host 'Port 5173 or 3001 is already in use. Stop the existing service before starting.'; exit 1 }"
if errorlevel 1 (
  pause
  exit /b 1
)
powershell -NoProfile -Command "if (-not (Test-NetConnection 127.0.0.1 -Port 27017 -InformationLevel Quiet -WarningAction SilentlyContinue)) { Write-Host 'Warning: MongoDB is not listening on port 27017. Data may be unavailable.' }"
cd /d "%APP_DIR%"
start "PDD Shop Browser" /b powershell -NoProfile -Command "$ready = $false; for ($i=0; $i -lt 60; $i++) { try { $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:5173' -TimeoutSec 1; if ($r.StatusCode -eq 200) { $ready = $true; break } } catch {}; Start-Sleep -Seconds 1 }; if ($ready) { Start-Process 'http://localhost:5173' } else { Write-Host 'Web page did not start at http://localhost:5173. Check the errors above.' }"
echo Starting web and API. Keep this window open; close it to stop.
call npm run dev
echo The app has stopped.
pause
