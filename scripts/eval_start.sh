#!/usr/bin/env bash
# IdeaMesh evaluation launcher.
#
# Bootstraps the local environment from a fresh extract of the release
# tarball and starts both the backend binary and the UI server. Designed
# for sales / evaluation use — initialize once, hit Ctrl+C to stop both.
#
# What it does:
#   1. Locate `psql` (PATH → Postgres.app → Homebrew) and verify Postgres
#      and Redis are reachable.
#   2. Create the `ideamesh` database + role on first run (idempotent).
#   3. Launch the Go binary (`dock_<arch>_<os>`) on :8080.
#   4. `npm install --omit=dev` in `ui/` if needed, then `node server.js`
#      on :3000.
#   5. Wait. Ctrl+C cleanly terminates both child processes.
#
# Configurable env vars:
#   POSTGRES_DSN, REDIS_ADDR, ADDR, PORT, API_BASE,
#   AI_AGENT_API_KEY, AI_AGENT_BASE_URL, AI_AGENT_MODEL,
#   PG_BIN (override binary discovery),
#   SKIP_DB_INIT=true (don't try to create DB on startup),
#   SKIP_NPM_INSTALL=true (assume ui/node_modules is fresh).

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# ---- styling ---------------------------------------------------------------
if [[ -t 1 ]]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_RED=$'\033[31m'; C_DIM=$'\033[2m'
else
  C_RESET=""; C_BOLD=""; C_GREEN=""; C_YELLOW=""; C_RED=""; C_DIM=""
fi
say()  { printf "%s→%s %s\n" "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf "%s!%s %s\n" "$C_YELLOW" "$C_RESET" "$*" >&2; }
fail() { printf "%s✗%s %s\n" "$C_RED"   "$C_RESET" "$*" >&2; exit 1; }

# ---- locate Postgres binaries ---------------------------------------------
discover_pg_bin() {
  if [[ -n "${PG_BIN:-}" ]]; then echo "$PG_BIN"; return; fi
  if command -v psql >/dev/null 2>&1; then dirname "$(command -v psql)"; return; fi
  local candidates=(
    "/Applications/Postgres.app/Contents/Versions/latest/bin"
    "/opt/homebrew/opt/postgresql@17/bin"
    "/opt/homebrew/opt/postgresql@16/bin"
    "/opt/homebrew/opt/postgresql@15/bin"
    "/opt/homebrew/bin"
    "/usr/local/opt/postgresql@17/bin"
    "/usr/local/opt/postgresql@16/bin"
    "/usr/local/opt/postgresql@15/bin"
    "/usr/local/bin"
  )
  for dir in "${candidates[@]}"; do
    if [[ -x "$dir/psql" ]]; then echo "$dir"; return; fi
  done
  if [[ -d /Applications/Postgres.app/Contents/Versions ]]; then
    local newest
    newest="$(ls -1 /Applications/Postgres.app/Contents/Versions 2>/dev/null \
      | grep -E '^[0-9]+(\.[0-9]+)?$' | sort -t. -k1,1n -k2,2n | tail -1)"
    if [[ -n "$newest" && -x "/Applications/Postgres.app/Contents/Versions/$newest/bin/psql" ]]; then
      echo "/Applications/Postgres.app/Contents/Versions/$newest/bin"; return
    fi
  fi
  return 1
}

PG_BIN_DIR="$(discover_pg_bin || true)"
if [[ -z "$PG_BIN_DIR" ]]; then
  fail "psql not found. Install PostgreSQL or set PG_BIN=/path/to/postgres/bin"
fi
PSQL="$PG_BIN_DIR/psql"
say "Postgres binaries: $PG_BIN_DIR"

# ---- Postgres reachability -------------------------------------------------
PGHOST_DEFAULT="${PGHOST:-localhost}"
PGPORT_DEFAULT="${PGPORT:-5432}"
PGUSER_PROBE="${PGUSER_PROBE:-$(whoami)}"
if ! "$PSQL" -h "$PGHOST_DEFAULT" -p "$PGPORT_DEFAULT" -U "$PGUSER_PROBE" -d postgres -tAc 'SELECT 1' >/dev/null 2>&1; then
  warn "Cannot connect to PostgreSQL at $PGHOST_DEFAULT:$PGPORT_DEFAULT as $PGUSER_PROBE."
  warn "Make sure Postgres is running. macOS: 'brew services start postgresql@17' or open Postgres.app."
  exit 2
fi
say "PostgreSQL reachable at $PGHOST_DEFAULT:$PGPORT_DEFAULT"

# ---- Redis reachability ----------------------------------------------------
REDIS_HOST_PROBE="${REDIS_ADDR:-localhost:6379}"
REDIS_HOST="${REDIS_HOST_PROBE%%:*}"
REDIS_PORT="${REDIS_HOST_PROBE##*:}"
if command -v redis-cli >/dev/null 2>&1; then
  if ! redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" PING 2>/dev/null | grep -q PONG; then
    warn "Redis not responding at $REDIS_HOST:$REDIS_PORT. Start it: 'brew services start redis' or 'redis-server &'"
    exit 2
  fi
else
  if ! (echo > "/dev/tcp/$REDIS_HOST/$REDIS_PORT") 2>/dev/null; then
    warn "Cannot reach Redis at $REDIS_HOST:$REDIS_PORT (and redis-cli not installed)."
    exit 2
  fi
fi
say "Redis reachable at $REDIS_HOST:$REDIS_PORT"

# ---- create ideamesh DB if missing ----------------------------------------
DB_NAME="${DB_NAME:-ideamesh}"
DB_USER="${DB_USER:-ideamesh}"
DB_PASSWORD="${DB_PASSWORD:-test123456}"

db_exists() {
  "$PSQL" -h "$PGHOST_DEFAULT" -p "$PGPORT_DEFAULT" -U "$PGUSER_PROBE" -d postgres -tAc \
    "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" 2>/dev/null | grep -q 1
}

if [[ "${SKIP_DB_INIT:-false}" != "true" ]]; then
  if db_exists; then
    say "Database $DB_NAME already exists — skipping init"
  else
    say "Creating database $DB_NAME and role $DB_USER"
    "$PSQL" -h "$PGHOST_DEFAULT" -p "$PGPORT_DEFAULT" -U "$PGUSER_PROBE" -d postgres -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$DB_USER') THEN
    CREATE ROLE "$DB_USER" LOGIN PASSWORD '$DB_PASSWORD';
  END IF;
END
\$\$;
CREATE DATABASE "$DB_NAME" OWNER "$DB_USER";
GRANT ALL PRIVILEGES ON DATABASE "$DB_NAME" TO "$DB_USER";
SQL
  fi
fi

# ---- locate the backend binary --------------------------------------------
find_binary() {
  local match
  match="$(ls "$ROOT_DIR"/dock_* 2>/dev/null | head -1 || true)"
  if [[ -z "$match" ]]; then
    match="$(ls "$ROOT_DIR"/dock 2>/dev/null | head -1 || true)"
  fi
  echo "$match"
}

BACKEND_BIN="$(find_binary)"
if [[ -z "$BACKEND_BIN" || ! -x "$BACKEND_BIN" ]]; then
  fail "backend binary not found in $ROOT_DIR (expected dock_<arch>_<os> or dock)"
fi
say "backend binary: $(basename "$BACKEND_BIN")"

# ---- env for backend -------------------------------------------------------
export POSTGRES_DSN="${POSTGRES_DSN:-postgres://$DB_USER:$DB_PASSWORD@$PGHOST_DEFAULT:$PGPORT_DEFAULT/$DB_NAME?sslmode=disable}"
export REDIS_ADDR="${REDIS_ADDR:-$REDIS_HOST:$REDIS_PORT}"
export ADDR="${ADDR:-:8080}"

if [[ -z "${AI_AGENT_API_KEY:-}${AI_AGENT_BASE_URL:-}${AI_AGENT_MODEL:-}" ]]; then
  warn "AI_AGENT_API_KEY / BASE_URL / MODEL are unset. The site-wide system bot won't reply"
  warn "until you configure a per-bot LLM in the admin UI (or export them and restart)."
fi

# ---- launch backend --------------------------------------------------------
say "starting backend on $ADDR ..."
"$BACKEND_BIN" &
BACKEND_PID=$!

cleanup() {
  trap - INT TERM EXIT
  printf "\n%s↩%s shutting down\n" "$C_DIM" "$C_RESET"
  if [[ -n "${UI_PID:-}" ]] && kill -0 "$UI_PID" 2>/dev/null; then kill "$UI_PID"; fi
  if [[ -n "${BACKEND_PID:-}" ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then kill "$BACKEND_PID"; fi
  wait 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM EXIT

# ---- launch UI -------------------------------------------------------------
if [[ ! -d "$ROOT_DIR/ui" ]]; then
  warn "ui/ directory missing — backend will keep running on :8080 but no web UI."
  wait "$BACKEND_PID"
  exit $?
fi

if ! command -v node >/dev/null 2>&1; then
  warn "node not installed; UI cannot start. Install Node 18+ and re-run, or use the API directly on :8080."
  wait "$BACKEND_PID"
  exit $?
fi

if [[ "${SKIP_NPM_INSTALL:-false}" != "true" ]]; then
  if [[ ! -d "$ROOT_DIR/ui/node_modules/express" ]]; then
    say "installing UI runtime deps (express) ..."
    (cd "$ROOT_DIR/ui" && npm install --omit=dev --silent)
  fi
fi

export PORT="${PORT:-3000}"
export API_BASE="${API_BASE:-http://localhost:8080}"
export UI_STATIC_DIR="${UI_STATIC_DIR:-dist}"
say "starting UI on http://localhost:$PORT (proxying API → $API_BASE)"
(cd "$ROOT_DIR/ui" && node server.js) &
UI_PID=$!

printf "\n%s%sIdeaMesh ready:%s open %shttp://localhost:%s%s in your browser\n\n" \
  "$C_BOLD" "$C_GREEN" "$C_RESET" "$C_BOLD" "$PORT" "$C_RESET"
printf "%sCtrl+C stops both processes.%s\n" "$C_DIM" "$C_RESET"

wait
