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

# psql rejects Prisma-only URL parameters such as `?schema=public`.
PSQL_URL="${DATABASE_URL%%\?*}"

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

USER_TABLE_COUNT="$(psql "$PSQL_URL" -Atqc "
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
psql "$PSQL_URL" -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS citext;"

echo ""
echo "===== 2. REPLAY HISTORICAL MIGRATIONS IN APPLIED ORDER ====="
# Every migration's real SQL is executed, so the database gets everything the migrations create
# that `prisma db push` cannot: immutability triggers, functions, CHECK constraints and seeded
# rows. The only difference from filename order is the one known out-of-order pair — phase25
# (earlier timestamp) alters a table that phase23 creates, and production applied phase23 first.
MIGRATION_ORDER="$(
  find prisma/migrations -mindepth 1 -maxdepth 1 -type d -exec basename {} \; | sort |
    grep -v '^20260829070919_phase25_service_category_admin_controls$' |
    sed 's/^20260829130000_phase23_property_service_professionals$/&\
20260829070919_phase25_service_category_admin_controls/'
)"

EXPECTED_COUNT="$(find prisma/migrations -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
ACTUAL_COUNT="$(printf '%s\n' "$MIGRATION_ORDER" | grep -c .)"
if [ "$EXPECTED_COUNT" != "$ACTUAL_COUNT" ]; then
  echo "ERROR: Migration ordering lost a migration ($ACTUAL_COUNT of $EXPECTED_COUNT)."
  false
fi

printf '%s\n' "$MIGRATION_ORDER" | while IFS= read -r migration_name; do
  echo "Applying: $migration_name"
  psql "$PSQL_URL" -v ON_ERROR_STOP=1 -q -f "prisma/migrations/$migration_name/migration.sql" >/dev/null
  ./node_modules/.bin/prisma migrate resolve --applied "$migration_name" >/dev/null
done

echo ""
echo "===== 3. VERIFY NO DRIFT FROM prisma/schema.prisma ====="
./node_modules/.bin/prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --exit-code >/dev/null || {
  echo "ERROR: The replayed database does not match prisma/schema.prisma."
  false
}
echo "No drift."

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
