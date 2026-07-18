# ============================================================
# Self-Hosted PaaS - dev launcher (Windows / PowerShell)
#
# Boots the whole local stack:
#   1. Ensures .env exists (copies from .env.example on first run)
#   2. Installs npm dependencies if node_modules is missing
#   3. Starts Postgres + Redis via docker compose
#   4. Waits for Postgres, then applies DB migrations and seeds the admin
#   5. Opens the control-plane API and the web UI in two new windows
#
# Usage:
#   ./start.ps1                  # full boot
#   ./start.ps1 -SkipInfra       # don't touch docker (DB/Redis already running)
#   ./start.ps1 -SkipInstall     # don't run npm install
#   ./start.ps1 -SkipSetup       # don't apply migrations / seed admin
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

# Generate a cryptographically strong, base64-encoded random secret.
function New-RandomSecret {
  param([int]$ByteCount = 48)
  $bytes = [byte[]]::new($ByteCount)
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return [Convert]::ToBase64String($bytes)
}

# Ensure a secret in the env file has a strong value. Only placeholder
# ("change-me"), empty, or missing values are filled in, so real secrets a user
# has already set are never overwritten (idempotent on re-run). Returns $true if
# the file was changed.
function Set-EnvSecret {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$Key,
    [Parameter(Mandatory)][string]$Value
  )
  $lines = @(Get-Content -LiteralPath $Path)
  $pattern = "^\s*$([regex]::Escape($Key))\s*="
  $found = $false
  $changed = $false
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match $pattern) {
      $found = $true
      $current = (($lines[$i] -split '=', 2)[1]).Trim()
      if ([string]::IsNullOrWhiteSpace($current) -or $current -match 'change-me') {
        $lines[$i] = "$Key=$Value"
        $changed = $true
      }
      break
    }
  }
  if (-not $found) {
    $lines += "$Key=$Value"
    $changed = $true
  }
  if ($changed) {
    $full = (Resolve-Path -LiteralPath $Path).ProviderPath
    $text = ($lines -join "`n") + "`n"
    [System.IO.File]::WriteAllText($full, $text, (New-Object System.Text.UTF8Encoding($false)))
  }
  return $changed
}

# 1. Environment file
if (-not (Test-Path .env)) {
  Write-Log "No .env found - creating one from .env.example"
  Copy-Item .env.example .env
}

# The control-plane fails fast on missing/weak/placeholder JWT and encryption
# secrets, so make sure .env has strong random values before we try to boot.
# JWT secrets need >=32 chars (48 bytes -> 64 base64 chars); ENCRYPTION_KEY must
# decode to exactly 32 bytes for AES-256-GCM.
$generated = @()
foreach ($item in @(
    @{ Key = 'JWT_SECRET';         Bytes = 48 },
    @{ Key = 'JWT_REFRESH_SECRET'; Bytes = 48 },
    @{ Key = 'WEBHOOK_SECRET';     Bytes = 32 },
    @{ Key = 'ENCRYPTION_KEY';     Bytes = 32 }
  )) {
  if (Set-EnvSecret -Path '.env' -Key $item.Key -Value (New-RandomSecret -ByteCount $item.Bytes)) {
    $generated += $item.Key
  }
}
if ($generated.Count -gt 0) {
  Write-Log ("Generated strong random secret(s) in .env: " + ($generated -join ', '))
  Write-Warn "These are local dev secrets in .env. Set your own strong values for production."
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
  Write-Log "Applying database migrations..."
  npm run db:migrate
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
