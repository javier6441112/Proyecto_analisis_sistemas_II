# Arranque del sistema completo para el video (Windows PowerShell).
#   .\iniciar.ps1            → verifica todo y levanta http://127.0.0.1:3000
#   .\iniciar.ps1 -Recargar  → además ejecuta la carga canónica e ingesta del RAG
param([switch]$Recargar)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$env:CV_DATA_DIR = (Resolve-Path .\datos\datos-proyecto-final).Path
$env:CV_DB_DIR   = Join-Path $PWD.Path '.cv-db'

function Ok($t)    { Write-Host "  ✔ $t" -ForegroundColor Green }
function Falla($t) { Write-Host "  ✘ $t" -ForegroundColor Red; exit 1 }

Write-Host 'Comprobando requisitos...' -ForegroundColor Cyan
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Falla 'Node.js no está instalado (se requiere 22 LTS)' }
Ok "Node $(node --version)"
try { Invoke-RestMethod http://127.0.0.1:11434/api/version -TimeoutSec 5 | Out-Null; Ok 'Ollama en 127.0.0.1:11434' }
catch { Falla 'Ollama no responde. Abra la aplicación Ollama e intente de nuevo.' }
$modelos = (Invoke-RestMethod http://127.0.0.1:11434/api/tags).models.name
foreach ($m in 'qwen3.5:9b', 'bge-m3') {
  if ($modelos -notcontains $m -and $modelos -notcontains "$($m):latest") { Falla "Falta el modelo $m. Ejecute: ollama pull $m" }
  Ok "Modelo $m"
}
if (-not (Test-Path node_modules)) { npm install }

if ($Recargar -or -not (Test-Path $env:CV_DB_DIR)) {
  npm run cargar:datos; if ($LASTEXITCODE) { Falla 'La carga canónica falló' }
  npm run rag:ingestar; if ($LASTEXITCODE) { Falla 'La ingesta del RAG falló' }
}
if (-not (Test-Path web\node_modules)) { npm run web:install }
if (-not (Test-Path web\dist\index.html)) { npm run web:build }

Write-Host "`nAbra http://127.0.0.1:3000 (Ctrl+C para detener)" -ForegroundColor Cyan
Write-Host "Usuarios iniciales: gerencia emorales / gerente2026 · asesores as-01..as-06 / asesor2026 (cambiar con npm run usuarios)" -ForegroundColor DarkGray
npm run api
