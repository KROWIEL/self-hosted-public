#!/usr/bin/env bash
# ============================================================
# Self-Hosted PaaS — dev launcher (Linux / macOS)
#
# Boots the whole local stack:
#   1. Ensures .env exists (copies from .env.example on first run)
#   2. Installs npm dependencies if node_modules is missing
#   3. Starts Postgres + Redis via docker compose
#   4. Waits for Postgres, then applies DB migrations and seeds the admin
#   5. Runs the control-plane API and the web UI together
#
# Usage:
#   ./start.sh                 # full boot
#   ./start.sh --skip-infra    # don't touch docker (DB/Redis already running)
#   ./start.sh --skip-install  # don't run npm install
#   ./start.sh --skip-setup    # don't apply migrations / seed admin
#
# Stop everything with Ctrl+C.
# ============================================================
set -euo pipefail

cd "$(dirname "$0")"

SKIP_INFRA=0
SKIP_INSTALL=0
SKIP_SETUP=0
for arg in "$@"; do
  case "$arg" in
    --skip-infra) SKIP_INFRA=1 ;;
    --skip-install) SKIP_INSTALL=1 ;;
    --skip-setup) SKIP_SETUP=1 ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

log()  { printf '\033[1;36m[start]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[start]\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31m[start]\033[0m %s\n' "$*" >&2; }

# Resolve the docker compose command (v2 plugin or legacy binary).
compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
  else
    err "docker compose not found. Install Docker to run Postgres/Redis, or use --skip-infra."
    exit 1
  fi
}

# Generate a cryptographically strong, base64-encoded random secret.
# $1 = number of random bytes. Prints the secret on a single line.
gen_secret() {
  local bytes="$1"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 "$bytes" | tr -d '\n'
  elif [ -r /dev/urandom ]; then
    head -c "$bytes" /dev/urandom | base64 | tr -d '\n'
  else
    err "No secure RNG available (need openssl or /dev/urandom) to generate secrets."
    exit 1
  fi
}

# Ensure a secret in the env file has a strong value. Only placeholder
# ("change-me"), empty, or missing values are filled in, so real secrets a user
# has already set are never overwritten (idempotent on re-run). Returns success
# (0) if the file was changed, non-zero if left untouched.
set_env_secret() {
  local file="$1" key="$2" value="$3"
  local tmp line current found=0 changed=0
  tmp="$(mktemp)"
  while IFS= read -r line || [ -n "$line" ]; do
    if printf '%s' "$line" | grep -qE "^[[:space:]]*${key}[[:space:]]*="; then
      found=1
      current="$(printf '%s' "${line#*=}" | tr -d '[:space:]')"
      if [ -z "$current" ] || printf '%s' "$current" | grep -q 'change-me'; then
        printf '%s=%s\n' "$key" "$value" >> "$tmp"
        changed=1
      else
        printf '%s\n' "$line" >> "$tmp"
      fi
    else
      printf '%s\n' "$line" >> "$tmp"
    fi
  done < "$file"
  if [ "$found" -eq 0 ]; then
    printf '%s=%s\n' "$key" "$value" >> "$tmp"
    changed=1
  fi
  mv "$tmp" "$file"
  return $((1 - changed))
}

# 1. Environment file
if [ ! -f .env ]; then
  log "No .env found — creating one from .env.example"
  cp .env.example .env
fi

# The control-plane fails fast on missing/weak/placeholder JWT and encryption
# secrets, so make sure .env has strong random values before we try to boot.
# JWT secrets need >=32 chars (48 bytes -> 64 base64 chars); ENCRYPTION_KEY must
# decode to exactly 32 bytes for AES-256-GCM.
generated=()
if set_env_secret .env JWT_SECRET "$(gen_secret 48)"; then generated+=("JWT_SECRET"); fi
if set_env_secret .env JWT_REFRESH_SECRET "$(gen_secret 48)"; then generated+=("JWT_REFRESH_SECRET"); fi
if set_env_secret .env WEBHOOK_SECRET "$(gen_secret 32)"; then generated+=("WEBHOOK_SECRET"); fi
if set_env_secret .env ENCRYPTION_KEY "$(gen_secret 32)"; then generated+=("ENCRYPTION_KEY"); fi
if [ "${#generated[@]}" -gt 0 ]; then
  log "Generated strong random secret(s) in .env: ${generated[*]}"
  warn "These are local dev secrets in .env. Set your own strong values for production."
fi

# 2. Dependencies
if [ "$SKIP_INSTALL" -eq 0 ] && [ ! -d node_modules ]; then
  log "Installing npm dependencies (workspaces)…"
  npm install
fi

# 3. Infrastructure (Postgres + Redis)
if [ "$SKIP_INFRA" -eq 0 ]; then
  log "Starting Postgres + Redis…"
  compose up -d postgres redis

  log "Waiting for Postgres to become ready…"
  for i in $(seq 1 30); do
    if compose exec -T postgres pg_isready -U selfhosted >/dev/null 2>&1; then
      log "Postgres is ready."
      break
    fi
    if [ "$i" -eq 30 ]; then
      err "Postgres did not become ready in time."
      exit 1
    fi
    sleep 1
  done
fi

# 4. Schema + seed (non-fatal: seed is idempotent-ish and may error if admin exists)
if [ "$SKIP_SETUP" -eq 0 ]; then
  log "Applying database migrations…"
  npm run db:migrate
  log "Seeding admin user (ignored if it already exists)…"
  npm run db:seed || warn "Seed skipped or already applied."
fi

# 5. Run both dev servers together, clean up on exit.
pids=()
cleanup() {
  log "Shutting down dev servers…"
  for pid in "${pids[@]:-}"; do
    kill "$pid" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT INT TERM

log "Starting control-plane API (port 3001)…"
npm run dev:cp &
pids+=("$!")

log "Starting web UI (port 3000)…"
npm run dev:web &
pids+=("$!")

log "Panel is starting — web: http://localhost:3000  api: http://localhost:3001/api/v1"
log "Press Ctrl+C to stop."
wait
