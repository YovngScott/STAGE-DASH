@echo off
setlocal
title Stage AI Labs Dashboard
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-local-dashboard.ps1"
if errorlevel 1 (
  echo.
  echo No se pudo iniciar el dashboard. Revisa el mensaje anterior.
  pause
)
exit /b %errorlevel%
