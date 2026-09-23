#!/usr/bin/env bash
set -euo pipefail

echo "======================================================================"
echo " NESAFRIC - FRESH DATABASE BOOTSTRAP"
echo "======================================================================"

if [ "${ALLOW_FRESH_DB_BOOTSTRAP:-}" != "1" ]; then
  echo "ERROR: Set ALLOW_FRESH_DB_BOOTSTRAP=1 explicitly."
  false
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is required."
  false
fi

DB_HOST="$(node -e 'try { const u = new URL(process.env.DATABASE_URL); process.stdout.write(u.hostname || "") } catch { process.stdout.write("") }')"
DB_NAME="$(node -e 'try { const u = new URL(process.env.DATABASE_URL); process.stdout.write((u.pathname || "").replace(/^\/+/, "")) } catch { process.stdout.write("") }')"

if [ -z "$DB_HOST" ] || [ -z "$DB_NAME" ]; then
  echo "ERROR: Could not safely parse DATABASE_URL."
  false
fi

echo "Target host: $DB_HOST"
echo "Target database: $DB_NAME"

case "$DB_HOST" in
  localhost|127.0.0.1|::1)
    ;;
  *)
    if [ "${ALLOW_REMOTE_FRESH_DB_BOOTSTRAP:-}" != "1" ]; then
      echo "ERROR: Remote database bootstrap blocked."
      false
    fi
    ;;
esac

if [ ! -x ./node_modules/.bin/prisma ]; then
  echo "ERROR: Local Prisma CLI is missing. Run npm ci first."
  false
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "ERROR: psql is required."
  false
fi

USER_TABLE_COUNT="$(psql "$DATABASE_URL" -Atqc "
SELECT COUNT(*)
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
  AND table_name <> '_prisma_migrations';
")"

echo "Existing user tables: $USER_TABLE_COUNT"

if [ "$USER_TABLE_COUNT" != "0" ]; then
  echo "ERROR: Target database is not empty."
  false
fi

echo ""
echo "===== 1. ENABLE REQUIRED POSTGRES EXTENSIONS ====="
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS citext;"

echo ""
echo "===== 2. CREATE CURRENT SCHEMA ====="
./node_modules/.bin/prisma db push --skip-generate

echo ""
echo "===== 3. REGISTER HISTORICAL MIGRATIONS ====="

find prisma/migrations -mindepth 1 -maxdepth 1 -type d -print | sort | while IFS= read -r migration_path; do
  migration_name="$(basename "$migration_path")"
  echo "Registering: $migration_name"
  ./node_modules/.bin/prisma migrate resolve --applied "$migration_name"
done

echo ""
echo "===== 4. VERIFY MIGRATION STATE ====="
./node_modules/.bin/prisma migrate deploy

echo ""
echo "===== 5. GENERATE PRISMA CLIENT ====="
./node_modules/.bin/prisma generate

echo ""
echo "===== 6. MIGRATION STATUS ====="
./node_modules/.bin/prisma migrate status

echo ""
echo "======================================================================"
echo " FRESH DATABASE BOOTSTRAP COMPLETE"
echo "======================================================================"
