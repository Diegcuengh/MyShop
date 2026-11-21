@echo off
setlocal
title MyShop Desktop Launcher
echo MyShop Desktop Launcher v0.0.3/2026-11-21/06:05:05
powershell.exe -NoProfile -File "%~dp0start_desktop.ps1"
if errorlevel 1 pause
