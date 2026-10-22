# NesAfric production deployment record

Deployed 22 October 2026 to Google Cloud project `nesafric-production` (europe-west1). Staging was skipped at the owner's instruction.

**Not cut over.** `nesafric.com` DNS (Cloudflare) and the Meta webhook are unchanged and wait for separate approval.

## 1. What is running

| Item | Value |
|---|---|
| Service URL | https://nesafric-web-566189824549.europe-west1.run.app |
| Cloud Run service / revision | `nesafric-web` / `nesafric-web-00001-2rt` |
| Image | `europe-west1-docker.pkg.dev/nesafric-production/nesafric/web:2822ee2` |
| Image digest | `sha256:e40bf7c8d8f3104a72f486a5c02f7c49998ee001e7bbe9843708fdd4acf57904` |
| Source | branch `release/nesafric-cloudrun`, commit `2822ee2` (WhatsApp stack `81b2b1b` + lease-schema fix + Cloud Run build). **Not merged to `main`.** |
| Scaling | 1 vCPU, 1 GiB, min 0, max 5, concurrency 40, timeout 300 s |
| Runtime identity | `nesafric-web@nesafric-production.iam.gserviceaccount.com` (Cloud SQL client, secret accessor on its own secrets, object admin on the two media buckets) |
| Database | Cloud SQL `nesafric-prod-db`, PostgreSQL 18, Enterprise, `db-custom-1-3840`, 20 GB SSD, PITR 7 days, 14 backups, deletion protection, `ENCRYPTED_ONLY`; via the Cloud SQL connector socket |
| Media buckets | `nesafric-production-media-public`, `nesafric-production-media-private` (both uniform access, public access prevention; public media served through the app's media route) |
| Backups bucket | `nesafric-production-db-backups` (30-day retention policy, not locked) |
| Jobs | Cloud Scheduler `nesafric-jobs-run`, every 5 minutes, `POST /api/jobs/run` with `x-jobs-run-secret` |
| Secrets | `DATABASE_URL`, `SESSION_SECRET`, `OTP_HASH_SECRET`, `JOBS_RUN_SECRET`, `INVITATION_TOKEN_ENCRYPTION_KEY`, `STORAGE_LOCAL_SIGNING_SECRET`, `db-app-password` (all generated new) |

## 2. Data migration

| Step | Result |
|---|---|
| Source | Neon `neondb` (us-east-1), PostgreSQL 18.6, migration head `20261002090000` (63 applied) |
| Inventory | `neon-inventory.txt` (read-only) |
| Dump | `neon-prod-20261022T153824Z.dump`, 1,096,315 bytes, SHA-256 `cb7b0a63eb8510b1fda14817280e75a7efbf3e03e7b15ec13ac12acc3e97f88d`; excludes Neon's sample table `playing_with_neon` |
| Stored | `gs://nesafric-production-db-backups/neon/` (dump, checksum, inventory) |
| Restore | `pg_restore --single-transaction --exit-on-error`: no errors; checksum verified first |
| Verification | Identical to Neon (order-insensitive): 63 migrations, row counts of all 186 tables, 2,176 constraints (0 unvalidated), 607 indexes, 63 functions, 23 triggers, sequences, `citext` 1.8 |
| Backup before migrating | On-demand Cloud SQL backup `1792684026977` |
| Pending migrations | 14 applied with `prisma migrate deploy` (`20261017120000` … `20261021120000`) |
| Drift | `prisma migrate diff --exit-code`: no difference |

Neon was only read. It is unchanged and remains the rollback source.

## 3. Smoke tests (run.app URL)

| Check | Result |
|---|---|
| `/` | 200 |
| `/api/health` | 200, `HEALTHY` |
| `/marketplace/properties` | 200; browser shows "19 properties available" (all 19 PUBLISHED listings from Cloud SQL) |
| `/api/public/listings` | 19 listings; cover images on `images.nesafric.com` load (200) |
| `/login`, `/register`, `/robots.txt`, `/sitemap.xml` | 200 |
| `POST /api/jobs/run` via Scheduler | 200 in 1.4 s |
| Error logs | none |

Not tested: sign-in, uploads, any workspace flow, email/SMS/WhatsApp sends, mobile app against this URL.

## 4. Known gaps

1. **Third-party credentials are not configured.** Vercel returns sensitive values masked, so they could not be copied: AI provider, Resend, Google OAuth, payments (MTN MoMo, Telecel Cash, AT Money, card, bank transfer), billing, calendar, e-signature, geocoding, malware scanner, S3 storage keys, Arkesel SMS. Features that need them fail closed until the values are added to Secret Manager.
2. **New internal secrets.** Sessions from Vercel are invalid (users sign in again). Tenant access codes and team invitations issued before today cannot be redeemed; reissue them.
3. **Existing media stays on `images.nesafric.com`** (public URLs keep working). New uploads go to GCS. Private objects in the old S3 bucket are not reachable until its keys are provided or the objects are copied to GCS.
4. **Client IP** for guest rate limits: no trusted header configured on Cloud Run (`TRUSTED_CLIENT_IP_HEADER` unset), so IP-based limits have no identity.
5. **WhatsApp disabled**: no WhatsApp env vars; the Meta app/token still belongs to Tap & Order.
6. `NEXT_PUBLIC_SITE_URL` in Vercel production was `https://umoafric.com` (Vercel `DEPLOYMENT_NOT_FOUND`). This build uses `https://www.nesafric.com`.
7. A "KORA OS" campaign creative appears in the NesAfric marketplace carousel (existing production data).
8. Min instances 0: first request after idle takes ~10 s.

## 5. Cutover (needs approval)

### Load balancer (created 22 October 2026)

Cloud Run domain mapping was refused (the account is a delegated, not verified, Search Console owner), so a global external Application Load Balancer fronts the service.

| Resource | Name / value |
|---|---|
| Global IPv4 | `nesafric-web-ipv4` = `35.186.238.70` |
| Global IPv6 | `nesafric-web-ipv6` = `2600:1901:0:e861::` |
| Serverless NEG | `nesafric-web-neg` (europe-west1 → `nesafric-web`) |
| Backend service | `nesafric-web-be` (EXTERNAL_MANAGED) |
| URL maps | `nesafric-web-urlmap` (HTTPS), `nesafric-web-http-redirect` (HTTP → HTTPS, 301) |
| Certificate | `nesafric-web-cert`, Google-managed, `nesafric.com` + `www.nesafric.com`; provisions after DNS points at the IPs |
| Forwarding rules | `nesafric-web-https-ipv4/ipv6` (443), `nesafric-web-http-ipv4/ipv6` (80) |
| Cost | ~USD 18 / month (forwarding rules) + USD 0.008 / GB processed |

Verified before DNS: HTTP on the IPv4 address returns 301 to HTTPS; with a temporary self-signed certificate (removed afterwards), `/`, `/api/health`, `/marketplace/properties` and `/api/public/listings` returned 200 through the load balancer.

### Cloudflare records (applied 22 October 2026)

Zone `nesafric.com` (`c8434787f1eaf2dee642dabecf914d8d`) in account "Billynganyunfor@outlook.com's Account" (`3760725eeab45e7e7f6dd9049fc04652`), nameservers `arely`/`cleo`.

| Name | Type | Before (rollback) | After |
|---|---|---|---|
| `@` | A | `76.76.21.21`, proxied (Vercel) | `35.186.238.70`, DNS only |
| `www` | CNAME → A | `6da7f8f3eb8ee1e8.vercel-dns-016.com`, proxied (Vercel) | A `35.186.238.70`, DNS only |

AAAA records (`2600:1901:0:e861::`) are not added yet; IPv6 through the load balancer has not been tested. Unchanged: `api` A `138.68.144.187` (proxied), `images` R2 bucket, MX, TXT (SPF, DMARC, DKIM, Google and Vercel verification).

1. Change the Cloudflare records above.
2. Point the mobile app at the same domain (no change needed if DNS moves).
3. Meta: NesAfric-owned app and system user, then the webhook `https://www.nesafric.com/api/webhooks/whatsapp`.

## 6. Rollback

- Before DNS changes: nothing serves real users from Cloud Run, so no rollback is needed.
- After DNS changes: revert the Cloudflare records. Neon is untouched, but the Vercel deployment is disabled (`402`), so Vercel billing must be restored first. Rows written to Cloud SQL after cutover must be exported (by `createdAt`) before switching back.
- Cloud Run: `gcloud run services update-traffic nesafric-web --to-revisions=<previous>=100`.
- Database: point-in-time recovery or backup `1792684026977` (state right after the Neon restore, before the 14 migrations).
