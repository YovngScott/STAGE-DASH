@echo off
setlocal
title Stage AI Labs Dashboard
cd /d "%~dp0"

set "NODE_EXE="
for %%N in (node.exe) do set "NODE_EXE=%%~$PATH:N"
if not defined NODE_EXE if exist "C:\Program Files\nodejs\node.exe" set "NODE_EXE=C:\Program Files\nodejs\node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE_EXE if exist "C:\Users\Joseph\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" set "NODE_EXE=C:\Users\Joseph\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

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

rem Start the server in its own window. Do not open the browser until Vite is ready.
start "Stage AI Labs Dashboard Server" /min "%NODE_EXE%" "%CD%\node_modules\vite\bin\vite.js" --host 127.0.0.1 --port 5173 --strictPort

set "READY="
for /l %%I in (1,1,30) do (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; try { $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 -Uri 'http://127.0.0.1:5173/'; if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { exit 0 } } catch {}; exit 1" >nul 2>&1
  if not errorlevel 1 (
    set "READY=1"
    goto :open_dashboard
  )
  timeout /t 1 /nobreak >nul
)

echo El dashboard no respondio en el puerto 5173. Revisa la ventana del servidor.
pause
exit /b 1

:open_dashboard
start "" "http://127.0.0.1:5173/"
exit /b 0
