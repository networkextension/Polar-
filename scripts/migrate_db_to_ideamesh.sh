#!/usr/bin/env bash
# Migrates the application database from gin_auth/gin_tester to ideamesh/ideamesh.
#
# Usage:
#   ./scripts/migrate_db_to_ideamesh.sh                # in-place rename (default)
#   MODE=dump-restore ./scripts/migrate_db_to_ideamesh.sh
#
# Env overrides (with defaults):
#   OLD_DB=gin_auth
#   NEW_DB=ideamesh
#   OLD_USER=gin_tester
#   NEW_USER=ideamesh
#   NEW_USER_PASSWORD=test123456    # only used if NEW_USER must be created
#   PG_SUPERUSER=$(whoami)
#   PG_HOST=localhost
#   PG_PORT=5432
#   MODE=rename | dump-restore
#   RENAME_USER=true                # set to false to keep OLD_USER unchanged
#   PG_BIN=/path/to/postgres/bin    # only needed if psql is not in PATH and
#                                   # auto-discovery (Postgres.app, Homebrew) fails
#
# `rename` mode is atomic and preserves data, sequences, and privileges.
# It fails if any session is connected to OLD_DB; the script terminates
# those sessions before issuing ALTER DATABASE.
#
# `dump-restore` mode keeps OLD_DB intact and creates a fresh NEW_DB
# from a logical dump. Useful for parallel-copy validation before drop.

set -euo pipefail

OLD_DB="${OLD_DB:-gin_auth}"
NEW_DB="${NEW_DB:-ideamesh}"
OLD_USER="${OLD_USER:-gin_tester}"
NEW_USER="${NEW_USER:-ideamesh}"
NEW_USER_PASSWORD="${NEW_USER_PASSWORD:-test123456}"
PG_SUPERUSER="${PG_SUPERUSER:-$(whoami)}"
PG_HOST="${PG_HOST:-localhost}"
PG_PORT="${PG_PORT:-5432}"
MODE="${MODE:-rename}"
RENAME_USER="${RENAME_USER:-true}"

# Locate PostgreSQL binaries. PATH first, then Postgres.app (macOS), then
# common Homebrew prefixes. Override with PG_BIN=/path/to/bin if needed.
discover_pg_bin() {
  if [[ -n "${PG_BIN:-}" ]]; then
    echo "$PG_BIN"; return
  fi
  if command -v psql >/dev/null 2>&1; then
    dirname "$(command -v psql)"; return
  fi
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
    if [[ -x "$dir/psql" ]]; then
      echo "$dir"; return
    fi
  done
  # Postgres.app multi-version fallback: pick the highest numeric Versions/*.
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
  echo "ERROR: cannot find psql in PATH or known macOS / Homebrew locations." >&2
  echo "       Set PG_BIN=/path/to/postgres/bin and retry." >&2
  exit 3
fi
echo "→ using PostgreSQL binaries from $PG_BIN_DIR"

PSQL_BIN="$PG_BIN_DIR/psql"
PG_DUMP_BIN="$PG_BIN_DIR/pg_dump"
PG_RESTORE_BIN="$PG_BIN_DIR/pg_restore"

PSQL=("$PSQL_BIN" -h "$PG_HOST" -p "$PG_PORT" -U "$PG_SUPERUSER" -v ON_ERROR_STOP=1)

run_psql() {
  local db="$1"; shift
  "${PSQL[@]}" -d "$db" "$@"
}

role_exists() {
  run_psql postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='$1'" | grep -q 1
}

ensure_new_user() {
  if role_exists "$NEW_USER"; then
    echo "→ role $NEW_USER already exists, leaving as-is"
    return
  fi

  if [[ "$RENAME_USER" == "true" ]] && role_exists "$OLD_USER"; then
    echo "→ ALTER ROLE $OLD_USER RENAME TO $NEW_USER"
    run_psql postgres -c "ALTER ROLE \"$OLD_USER\" RENAME TO \"$NEW_USER\";"
    # Renaming clears MD5-hashed passwords; reset so the app can log in.
    run_psql postgres -c "ALTER ROLE \"$NEW_USER\" WITH PASSWORD '$NEW_USER_PASSWORD';"
    return
  fi

  echo "→ creating role $NEW_USER"
  run_psql postgres -c "CREATE ROLE \"$NEW_USER\" LOGIN PASSWORD '$NEW_USER_PASSWORD';"
}

terminate_connections() {
  local target="$1"
  echo "→ terminating active connections to $target"
  run_psql postgres -c "
    SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
     WHERE datname = '$target' AND pid <> pg_backend_pid();" >/dev/null
}

assert_db_exists() {
  if ! run_psql postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$1'" | grep -q 1; then
    echo "ERROR: database $1 does not exist on $PG_HOST:$PG_PORT" >&2
    exit 1
  fi
}

assert_db_absent() {
  if run_psql postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$1'" | grep -q 1; then
    echo "ERROR: target database $1 already exists. Drop it first or pick a different NEW_DB." >&2
    exit 1
  fi
}

apply_grants() {
  echo "→ re-applying owner + privileges on $NEW_DB"
  run_psql postgres -c "ALTER DATABASE \"$NEW_DB\" OWNER TO \"$NEW_USER\";"
  run_psql postgres -c "GRANT ALL PRIVILEGES ON DATABASE \"$NEW_DB\" TO \"$NEW_USER\";"
  run_psql "$NEW_DB" -c "GRANT ALL ON ALL TABLES IN SCHEMA public TO \"$NEW_USER\";"
  run_psql "$NEW_DB" -c "GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO \"$NEW_USER\";"
  run_psql "$NEW_DB" -c "GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO \"$NEW_USER\";"
  run_psql "$NEW_DB" -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO \"$NEW_USER\";"
  run_psql "$NEW_DB" -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO \"$NEW_USER\";"
  # Reassign anything still owned by the old user to the new user (no-op if OLD_USER is gone).
  if role_exists "$OLD_USER" && [[ "$OLD_USER" != "$NEW_USER" ]]; then
    run_psql "$NEW_DB" -c "REASSIGN OWNED BY \"$OLD_USER\" TO \"$NEW_USER\";" || true
  fi
}

mode_rename() {
  assert_db_exists "$OLD_DB"
  assert_db_absent "$NEW_DB"
  ensure_new_user
  terminate_connections "$OLD_DB"
  echo "→ ALTER DATABASE $OLD_DB RENAME TO $NEW_DB"
  run_psql postgres -c "ALTER DATABASE \"$OLD_DB\" RENAME TO \"$NEW_DB\";"
  apply_grants
}

mode_dump_restore() {
  local dump_file="${DUMP_FILE:-/tmp/${OLD_DB}_to_${NEW_DB}.sqlc}"
  assert_db_exists "$OLD_DB"
  assert_db_absent "$NEW_DB"
  ensure_new_user
  echo "→ pg_dump $OLD_DB → $dump_file"
  "$PG_DUMP_BIN" -h "$PG_HOST" -p "$PG_PORT" -U "$PG_SUPERUSER" -Fc -f "$dump_file" "$OLD_DB"
  echo "→ creating $NEW_DB owned by $NEW_USER"
  run_psql postgres -c "CREATE DATABASE \"$NEW_DB\" OWNER \"$NEW_USER\";"
  echo "→ pg_restore into $NEW_DB"
  "$PG_RESTORE_BIN" -h "$PG_HOST" -p "$PG_PORT" -U "$PG_SUPERUSER" \
    --no-owner --role="$NEW_USER" -d "$NEW_DB" "$dump_file"
  apply_grants
  echo "Dump kept at $dump_file (delete manually once verified)."
  echo "OLD_DB=$OLD_DB and OLD_USER=$OLD_USER are still present."
  echo "Drop them after verifying the new DB:"
  echo "  DROP DATABASE $OLD_DB;"
  echo "  DROP ROLE $OLD_USER;"
}

echo "Migration plan:"
echo "  database: $OLD_DB → $NEW_DB"
echo "  user:     $OLD_USER → $NEW_USER (rename_user=$RENAME_USER)"
echo "  host:     $PG_HOST:$PG_PORT  (superuser=$PG_SUPERUSER, mode=$MODE)"
echo

case "$MODE" in
  rename)        mode_rename ;;
  dump-restore)  mode_dump_restore ;;
  *)             echo "ERROR: unknown MODE=$MODE (expected: rename | dump-restore)" >&2; exit 2 ;;
esac

echo
echo "✓ done. Update POSTGRES_DSN to use the new credentials, e.g.:"
echo "  export POSTGRES_DSN='postgres://${NEW_USER}:${NEW_USER_PASSWORD}@${PG_HOST}:${PG_PORT}/${NEW_DB}?sslmode=disable'"
