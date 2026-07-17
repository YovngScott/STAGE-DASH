$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$vite = Join-Path $projectRoot 'node_modules\vite\bin\vite.js'

$nodeCandidates = @(
  (Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1),
  'C:\Program Files\nodejs\node.exe',
  (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe'),
  'C:\Users\Joseph\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
$nodePath = [string]($nodeCandidates | Select-Object -First 1)

if (-not $nodePath) { throw 'No se encontró Node.js. Instala Node.js o abre Codex una vez para cargar su runtime.' }
if (-not (Test-Path -LiteralPath $vite)) { throw 'Faltan las dependencias del dashboard. Ejecuta pnpm install en la carpeta del proyecto.' }

$uri = 'http://127.0.0.1:5173/'
$ready = $false
try {
  $response = Invoke-WebRequest -UseBasicParsing -Uri $uri -TimeoutSec 1
  $ready = $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
} catch {}

if (-not $ready) {
  Start-Process -FilePath $nodePath -ArgumentList @($vite, '--host', '127.0.0.1', '--port', '5173', '--strictPort') -WorkingDirectory $projectRoot -WindowStyle Hidden | Out-Null
  for ($i = 0; $i -lt 30 -and -not $ready; $i++) {
    Start-Sleep -Seconds 1
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $uri -TimeoutSec 1
      $ready = $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
    } catch {}
  }
}

if (-not $ready) { throw 'El dashboard no respondió en el puerto 5173.' }
Start-Process $uri
