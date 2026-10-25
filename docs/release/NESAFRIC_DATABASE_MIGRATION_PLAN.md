# NesAfric database migration plan: Neon to Cloud SQL (PostgreSQL 18, europe-west1)

Status: **executed 22 October 2026** (Phases A–C into production directly; staging skipped). Results: `NESAFRIC_PRODUCTION_DEPLOYMENT.md`. Phases D (media copy) and E (DNS cutover) are open.

## 1. Where the data is today

| Source | Engine | Size | State | Role |
|---|---|---|---|---|
| Neon `ep-spring-poetry-avend84k` (`neondb`, AWS us-east-1) | PostgreSQL 18.6 | 24 MB | Reachable | **Production source of truth** (Vercel production env points at it). Schema is behind `main`: `WhatsAppNumberAssignment` (migration `20261018230000`) is missing. |
| Cloud SQL `nesafric-prod-db` (project `nesafric`, europe-west2) | PostgreSQL 18 | 20 GB disk | **Suspended** (billing) | Unknown. Created 23 Sep 2026. Must be inspected before it is ever deleted, in case it holds data that is not in Neon. |

The production website is offline (Vercel `402`), so production currently receives no writes. That makes a consistent final copy simple, but the site stays down until cutover or until Vercel is restored.

## 2. Target

| | Staging | Production (proposed) |
|---|---|---|
| Project | `nesafric-staging` | `nesafric-production` |
| Instance | `nesafric-staging-db` | `nesafric-prod-db` |
| Edition / tier | Enterprise, `db-f1-micro` (shared core) | Enterprise, `db-custom-1-3840` (1 vCPU, 3.75 GB); HA optional |
| Storage | 10 GB SSD, auto-increase | 20 GB SSD, auto-increase |
| Backups | daily 02:00 UTC, 7 kept, PITR 7 days | daily, 14 kept, PITR 7 days |
| TLS | `ENCRYPTED_ONLY` | `ENCRYPTED_ONLY` |
| Deletion protection | on | on |
| Connection | Cloud SQL Auth Proxy / Cloud Run connector; no authorised networks | same |
| Est. cost | ~USD 10 / month | ~USD 55 / month (~110 with HA) |

Staging gets a fresh schema and seed data only. **Production data is never copied into staging.**

## 3. Phases

### Phase A: inventory (read-only, needs approval for production reads)

On Neon, record:

1. `_prisma_migrations`: applied names, any failed or rolled-back rows.
2. Row count per table (`pg_class.reltuples` is not enough; use `count(*)`).
3. Extensions (`citext` is required), functions, triggers, CHECK constraints.
4. Constraints not validated: `select conname from pg_constraint where not convalidated`.
5. Index list (`pg_indexes`) and sequence values.
6. Media references: every `StorageObject` key and every `ListingMedia` / `MarketplaceAsset` URL, grouped by bucket.

### Phase B: backup

1. Create a Neon branch at the current LSN (instant, free) as an immutable restore point.
2. `pg_dump --format=custom --no-owner --no-acl` with a **PostgreSQL 18 client** (local `pg_dump` is 16.15 and cannot dump an 18 server; install `postgresql@18`).
3. SHA-256 of the dump. Upload to a private, uniform-access bucket in `nesafric-production` with a 30-day retention lock. Never to staging.

### Phase C: restore rehearsal

1. Create a temporary instance `nesafric-rehearsal-db` in `nesafric-production` (smallest tier, deleted afterwards).
2. `pg_restore --no-owner --no-acl --exit-on-error`.
3. Compare with Phase A: row counts per table must match exactly; same extensions, functions, triggers, indexes and constraints; zero unvalidated constraints; sequences at or above `max(id)`.
4. Run `prisma migrate status`, then `prisma migrate deploy` from the release-candidate commit to apply the pending migrations. Re-run the drift check (`prisma migrate diff --exit-code`).
5. Point a local build of the release candidate at the rehearsal database and run the smoke checks: sign-in, marketplace search, listing detail, workspace dashboards.
6. Record the timings. Delete the rehearsal instance.

Pass criteria: all counts equal, no drift, no failed migration, smoke checks pass.

### Phase D: media

1. Create `nesafric-production-public` (listing photos) and `nesafric-production-private` (identity documents and other private files; CMEK, public access prevention enforced).
2. Copy objects from the current S3-compatible bucket with Storage Transfer Service or `gcloud storage rsync`.
3. Verify every key from Phase A exists in GCS with the same size and checksum.

### Phase E: cutover (needs separate approval)

1. Confirm production still receives no writes.
2. Final `pg_dump` from Neon, checksum, restore into `nesafric-prod-db`, repeat the Phase C checks.
3. Apply the pending migrations with `prisma migrate deploy`.
4. Deploy Cloud Run with the Cloud SQL connection and GCS storage settings from Secret Manager.
5. Smoke test on the `run.app` URL.
6. Change Cloudflare DNS for `nesafric.com` / `www` (separately approved).

## 4. Rollback

- Neon is not modified at any point and stays the fallback for at least 30 days.
- Before DNS changes: delete or ignore the Cloud SQL copy. Nothing to undo.
- After DNS changes: point `DATABASE_URL` back at Neon (or the Phase B branch) and revert DNS. Writes made in Cloud SQL after cutover would be lost, so keep the window between cutover and sign-off short, and export any rows created after cutover (by `createdAt`) before switching back.
- Every Cloud SQL instance has deletion protection, daily backups and 7 days of point-in-time recovery.

## 5. Open decisions

1. Approval to read and dump production (Phases A and B).
2. What to do with the suspended `nesafric-prod-db`: restore billing on project `nesafric` to inspect it, or confirm it holds nothing.
3. High availability for production (doubles the database cost).
4. Cutover date and DNS change.
