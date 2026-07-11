# ============================================================
# Self-Hosted PaaS - dev launcher (Windows / PowerShell)
#
# Boots the whole local stack:
#   1. Ensures .env exists (copies from .env.example on first run)
#   2. Installs npm dependencies if node_modules is missing
#   3. Starts Postgres + Redis via docker compose
#   4. Waits for Postgres, then pushes the DB schema and seeds the admin
#   5. Opens the control-plane API and the web UI in two new windows
#
# Usage:
#   ./start.ps1                  # full boot
#   ./start.ps1 -SkipInfra       # don't touch docker (DB/Redis already running)
#   ./start.ps1 -SkipInstall     # don't run npm install
#   ./start.ps1 -SkipSetup       # don't push schema / seed admin
#
# If scripts are blocked, run once:
#   Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
# ============================================================
[CmdletBinding()]
param(
  [switch]$SkipInfra,
  [switch]$SkipInstall,
  [switch]$SkipSetup
)

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

function Write-Log  { param([string]$Message) Write-Host "[start] $Message" -ForegroundColor Cyan }
function Write-Warn { param([string]$Message) Write-Host "[start] $Message" -ForegroundColor Yellow }
function Write-Err  { param([string]$Message) Write-Host "[start] $Message" -ForegroundColor Red }

# Resolve the docker compose command (v2 plugin or legacy binary).
function Invoke-Compose {
  param([Parameter(ValueFromRemainingArguments = $true)] [string[]]$Args)
  docker compose version *> $null
  if ($LASTEXITCODE -eq 0) {
    & docker compose @Args
  }
  elseif (Get-Command docker-compose -ErrorAction SilentlyContinue) {
    & docker-compose @Args
  }
  else {
    Write-Err "docker compose not found. Install Docker Desktop to run Postgres/Redis, or use -SkipInfra."
    exit 1
  }
}

# 1. Environment file
if (-not (Test-Path .env)) {
  Write-Log "No .env found - creating one from .env.example"
  Copy-Item .env.example .env
  Write-Warn "Edit .env and set real secrets before using this in production."
}

# 2. Dependencies
if (-not $SkipInstall -and -not (Test-Path node_modules)) {
  Write-Log "Installing npm dependencies (workspaces)..."
  npm install
}

# 3. Infrastructure (Postgres + Redis)
if (-not $SkipInfra) {
  Write-Log "Starting Postgres + Redis..."
  Invoke-Compose up -d postgres redis

  Write-Log "Waiting for Postgres to become ready..."
  $ready = $false
  for ($i = 1; $i -le 30; $i++) {
    Invoke-Compose exec -T postgres pg_isready -U selfhosted *> $null
    if ($LASTEXITCODE -eq 0) {
      $ready = $true
      Write-Log "Postgres is ready."
      break
    }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) {
    Write-Err "Postgres did not become ready in time."
    exit 1
  }
}

# 4. Schema + seed (seed is non-fatal: it may error if the admin already exists)
if (-not $SkipSetup) {
  Write-Log "Pushing database schema..."
  npm run db:push
  Write-Log "Seeding admin user (ignored if it already exists)..."
  try { npm run db:seed } catch { Write-Warn "Seed skipped or already applied." }
}

# 5. Launch both dev servers in their own windows.
Write-Log "Starting control-plane API (port 3001)..."
Start-Process powershell -ArgumentList @(
  '-NoExit', '-Command',
  "Set-Location -Path '$PSScriptRoot'; npm run dev:cp"
)

Write-Log "Starting web UI (port 3000)..."
Start-Process powershell -ArgumentList @(
  '-NoExit', '-Command',
  "Set-Location -Path '$PSScriptRoot'; npm run dev:web"
)

Write-Log "Panel is starting - web: http://localhost:3000  api: http://localhost:3001/api/v1"
Write-Log "Two new windows opened (API + web). Close them to stop the servers."
