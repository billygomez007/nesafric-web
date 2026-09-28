#!/usr/bin/env bash
# Creates (or recreates) a disposable, LOCAL-ONLY PostgreSQL database for the integration suite,
# replays every migration in the repository's required order (scripts/bootstrap-fresh-database.sh),
# and seeds reference data. Prints the DATABASE_URL to use for `npx vitest run`.
#
#   scripts/create-isolated-test-database.sh nesafric_release_20260928_verify_test [role]
#
# Why an explicit role: a URL without a user name (postgresql://localhost/db) works for psql —
# libpq falls back to the OS user — but Prisma's schema engine sends no user name at all, which
# PostgreSQL rejects ("no PostgreSQL user name specified in startup packet") and Prisma reports as
# `P1010: User was denied access`. Using one explicit role for psql and Prisma avoids that and
# makes that role the database owner.
set -euo pipefail

DB_NAME="${1:-}"
ROLE="${2:-propertyos}"
HOST="${PGHOST_OVERRIDE:-localhost}"
PORT="${PGPORT_OVERRIDE:-5432}"

# Only clearly disposable names: this script drops the database if it already exists.
if ! [[ "$DB_NAME" =~ ^nesafric_[a-z0-9_]*test[a-z0-9_]*$ ]]; then
  echo "ERROR: database name must start with nesafric_ and contain 'test' (got '$DB_NAME')." >&2
  exit 1
fi
case "$HOST" in localhost|127.0.0.1|::1) ;; *) echo "ERROR: local PostgreSQL only." >&2; exit 1 ;; esac
if ! [[ "$ROLE" =~ ^[a-z_][a-z0-9_]*$ ]]; then echo "ERROR: invalid role name." >&2; exit 1; fi

ADMIN_URL="postgresql://${ROLE}@${HOST}:${PORT}/postgres"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q \
  -c "DROP DATABASE IF EXISTS \"${DB_NAME}\"" \
  -c "CREATE DATABASE \"${DB_NAME}\" OWNER \"${ROLE}\""

export DATABASE_URL="postgresql://${ROLE}@${HOST}:${PORT}/${DB_NAME}?schema=public"
ALLOW_FRESH_DB_BOOTSTRAP=1 bash "$(dirname "$0")/bootstrap-fresh-database.sh"
npx tsx prisma/seed.ts

echo
echo "Isolated test database ready. Run the suite with:"
echo "  DATABASE_URL='${DATABASE_URL}' npx vitest run"
