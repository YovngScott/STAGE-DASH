@echo off
setlocal
title Stage AI Labs Dashboard
cd /d "%~dp0"

rem If the dashboard is already running, just open it in the browser.
netstat -ano | findstr /r /c:":5173 .*LISTENING" >nul
if not errorlevel 1 (
  start "" "http://127.0.0.1:5173"
  exit /b 0
)

set "NODE_EXE="
for %%N in (node.exe) do set "NODE_EXE=%%~$PATH:N"
if not defined NODE_EXE set "NODE_EXE=C:\Users\Joseph\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

if not exist "%NODE_EXE%" (
  echo No se encontro Node.js. Abre Codex una vez o instala Node.js para iniciar el dashboard.
  pause
  exit /b 1
)

if not exist "node_modules\vite\bin\vite.js" (
  echo Faltan dependencias del dashboard. Ejecuta pnpm install desde esta carpeta.
  pause
  exit /b 1
)

start "" "http://127.0.0.1:5173"
"%NODE_EXE%" "node_modules\vite\bin\vite.js" --host 127.0.0.1 --port 5173 --strictPort
