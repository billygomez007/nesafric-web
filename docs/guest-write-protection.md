# Guest write protection (enquiries, viewings, web chat leads)

Unauthenticated visitors can contact a lister, request a viewing, or start a listing web chat
without an account. Each of these creates a lead or viewing and notifies the lister, so they are
protected server-side by `src/platform/security/`:

| Module | Purpose |
| --- | --- |
| `public-write-limit.ts` | Enforced, all-or-nothing rate limits; refunds on failure; expired-row sweep |
| `idempotency.ts` | `Idempotency-Key` replay only for an identical submission |
| `client-ip.ts` | Client IP from trusted infrastructure headers only |

Protected routes: `POST /api/public/listings/:id/leads`, `POST /api/public/listings/:id/viewings`,
`POST /api/public/webchat/conversations` (only when it creates a listing lead), and
`POST /api/public/webchat/conversations/:id/viewing-requests` (after the chat token is verified).
Web chat *messages* are not covered yet (they keep the existing per-conversation inbound limit).

## Default limits

| Rule id | Counts per | Window | Limit |
| --- | --- | --- | --- |
| `enquiry.ip.10m` | client IP (IPv6 /64) | 10 min | 30 |
| `enquiry.ip.day` | client IP | 24 h | 200 |
| `enquiry.contact.hour` | phone (last 9 digits) or email | 1 h | 5 |
| `enquiry.contact.day` | phone or email | 24 h | 20 |
| `enquiry.ip-listing.hour` | IP + listing | 1 h | 5 |
| `enquiry.listing.hour` | listing (all senders) | 1 h | 60 |
| `viewing.ip.10m` | client IP | 10 min | 30 |
| `viewing.lead.day` | lead | 24 h | 3 |
| `viewing.listing.hour` | listing | 1 h | 60 |

Windows are fixed (aligned to the clock), so a burst straddling a window boundary can reach up to
twice a limit. IP limits are deliberately loose because many Ghanaian mobile subscribers share
carrier-NAT addresses; contact, IP+listing and lead limits are the tight controls.

Behaviour:

- **All-or-nothing.** All rules for a request are charged in one transaction with conditional
  increments; if any rule is full the request gets `429 PUBLIC_WRITE_RATE_LIMITED` with
  `Retry-After`, and nothing is charged.
- **Failures are refunded.** If the lead/viewing isn't created (listing gone, viewing time in the
  past, lead not found, database error) the reserved slots are released.
- **Validation first.** Malformed input is rejected before any limit is charged.
- **Privacy.** Keys are HMAC-SHA256 hashed with `SESSION_SECRET`; raw IPs, phone numbers and
  emails are never stored or logged by these modules.

## Idempotency

Web and mobile forms send `Idempotency-Key` (reused only while the payload is identical).

- Same key + identical submission → the stored original response (`Idempotent-Replayed: true`),
  no new lead, no new notification, no rate-limit charge.
- Same key + different submission → `422 IDEMPOTENCY_KEY_REUSED`.
- Same key while the first request is still running → `409 IDEMPOTENCY_REQUEST_IN_PROGRESS`.
- Failed work releases the key.
- Records expire after 24 hours.

### Durable guarantee: one submission, one lead, one notification

The idempotency record is only the fast path. The durable guarantee is on the created row itself:
`MarketplaceLead` and `ViewingRequest` store `idempotencyKeyHash` (SHA-256 of the client's random
key) and `idempotencyFingerprint`, written **in the same transaction** that creates the row, with a
unique constraint on `(listingId, idempotencyKeyHash)`. Notifications are queued only after that
transaction commits.

What a customer sees when they retry the same submission (same key, same form contents):

| Situation | Result |
| --- | --- |
| First attempt still running | `409`, "already being processed" — nothing created |
| First attempt created the lead, result stored | the original lead (`Idempotent-Replayed: true`) |
| First attempt created the lead but storing the result failed, retry **within** 2 min | `409`; retry again shortly |
| Same, retry **after** the 2-minute stale window (claim retaken) | the route finds the lead bound to the submission and returns it (`Idempotent-Replayed: true`) — no new lead, notification or quota |
| Several such retries at once | at most one proceeds; if two reach creation, the unique constraint lets one commit and the other rolls back (before any notification) and returns the winner's lead |
| Retry after the idempotency record expired/was swept (>24 h) | still reconciled with the bound lead |

Privacy: reconciliation needs the client's secret random key **and** an identical submission
fingerprint on the **same listing**. Entering someone else's phone number or email never matches
their lead (it creates a separate lead, subject to the limits); reusing a key with different
contents is refused with `422`.

## Cleanup

Expired counters and idempotency records are deleted in bounded batches by the scheduled jobs
endpoint (`/api/jobs/run`), by `npm run worker` every 5 minutes, and opportunistically on ~2% of
guest writes. The sweep runs even if the job drain fails. The durable lead/viewing binding is never
swept.

How `/api/jobs/run` is triggered today:

- **Production:** Vercel Cron from `vercel.json` (`*/5 * * * *`, GET). Vercel runs crons only for
  the **production** deployment and authenticates with `Authorization: Bearer $CRON_SECRET`.
  The route accepts that header, so production needs `CRON_SECRET` set. The endpoint **fails
  closed**: with neither `CRON_SECRET` nor `JOBS_RUN_SECRET` set, every call gets
  `503 JOBS_RUN_NOT_CONFIGURED` and no work runs (local development may opt in with
  `ALLOW_UNAUTHENTICATED_JOBS_RUN=true`, which is ignored when `NODE_ENV=production`). If only
  `JOBS_RUN_SECRET` is set, Vercel's cron call is refused (401). Either way neither jobs nor this
  sweep run, so **set `CRON_SECRET` in production before deploying this change**. Confirm in the
  Vercel dashboard (Settings → Cron Jobs) that the job is listed and its recent invocations return
  200, and that the plan permits a 5-minute schedule.
- **Staging:** `.github/workflows/staging-jobs-cron.yml` POSTs every 5 minutes with
  `STAGING_JOBS_RUN_SECRET`.
- Preview deployments have no cron; the opportunistic sweep still bounds their tables.

## Deploying the migrations

This change adds two migrations, both additive:

- `20260925120000_public_write_protection` — new `PublicWriteCounter` and `PublicIdempotencyRecord` tables.
- `20260925130000_submission_idempotency_binding` — nullable `idempotencyKeyHash` /
  `idempotencyFingerprint` columns on `MarketplaceLead` and `ViewingRequest`, and unique indexes on
  `(listingId, idempotencyKeyHash)`. Existing rows stay NULL (Postgres unique indexes ignore NULLs).
  Index builds briefly block writes to those two tables; at current table sizes this is negligible.

Sequence (the build does not run migrations):

1. **Existing database (production/staging):** `npm run db:deploy` (`prisma migrate deploy`)
   **before** promoting the new code. Verified locally against a database built from `main`: it
   applies exactly these two migrations and leaves no schema drift.
2. **Brand-new empty database:** use `npm run db:bootstrap:fresh` (see
   `docs/FRESH_DATABASE_BOOTSTRAP.md`), **not** `migrate deploy`. On an empty database
   `migrate deploy` fails at the pre-existing out-of-order migration
   `20260829070919_phase25_service_category_admin_controls` (unrelated to this change). The bootstrap
   creates the current schema, including these tables/columns, and records all migrations.
   Known gap: the bootstrap does not create the history-immutability triggers defined in older
   migration SQL.
3. Deploy the application. Old code ignores the new columns/tables, so the migration can safely go
   first.

## Deployment settings

| Variable | Default | Notes |
| --- | --- | --- |
| `SESSION_SECRET` | required | Already required; also keys the rate-limit hashes. |
| `PUBLIC_WRITE_LIMITS` | unset | JSON `{ "rule id": integer 1–10000 }`. Unknown ids / invalid values are ignored with a warning and the default kept. On Vercel, environment variable changes apply to new deployments: **redeploy** after changing (no code change). |
| `TRUST_CLOUDFLARE_CLIENT_IP` | off | Keep off until the evidence below is collected. |
| `TRUSTED_CLIENT_IP_HEADER` | unset | Only for non-Vercel hosting behind a proxy that overwrites the named header. |
| `CLOUDFLARE_IP_RANGES` | built-in list | Override if Cloudflare publishes new ranges. |

Without `VERCEL=1` (set automatically on Vercel) or `TRUSTED_CLIENT_IP_HEADER`, every visitor
shares one `unknown` IP identity: per-IP limits then apply globally. Only the contact / listing /
lead limits remain individual. Don't run production like that.

## Client IP and Cloudflare: evidence required before `TRUST_CLOUDFLARE_CLIENT_IP=true`

On Vercel, `x-real-ip` / `x-forwarded-for` are overwritten by Vercel with the address that
connected to it; client-supplied values are not forwarded. If Cloudflare proxies the domain, that
address is a Cloudflare edge IP shared by many visitors, and the real visitor IP is only in
`cf-connecting-ip` — which is trustworthy **only** for requests that genuinely came through
Cloudflare. Turning trust on when Cloudflare is not in the path would let anyone relaying through
Cloudflare infrastructure (e.g. a Worker) choose their own rate-limit identity.

Observed on 2026-09-25 (public DNS via 8.8.8.8): `nesafric.com` and `www.nesafric.com` resolved only
to Cloudflare anycast addresses (104.21.58.116, 172.67.159.104 and Cloudflare IPv6). This suggests
proxying but was **not** confirmed with response headers, and conflicts with a dashboard check that
showed the records as unproxied.

Collect all of the following before enabling:

1. **Cloudflare dashboard:** the apex and `www` DNS records show *Proxied* (orange cloud), with a
   screenshot/date.
2. **Response headers** from `curl -sI https://nesafric.com/` and `https://www.nesafric.com/`:
   both `server: cloudflare` + `cf-ray` (Cloudflare edge) **and** `x-vercel-id` (reached Vercel).
3. **Peer check without logging IPs:** a temporary, reviewed diagnostic (or Vercel runtime log
   line) that records only booleans for a handful of requests — `peerIsCloudflare` (is the
   Vercel-observed `x-real-ip` inside `CLOUDFLARE_IP_RANGES`) and `hasCfConnectingIp` — never the
   addresses themselves. Enable only if these are consistently `true`; remove the diagnostic after.
4. **Origin lock-down decided:** if Cloudflare proxies, the `*.vercel.app` deployment URLs can
   still be reached directly. Either accept that (direct requests then use their own Vercel-observed
   IP, which is safe) or restrict direct access (e.g. Vercel Firewall rule allowing only Cloudflare
   ranges on the production domain).
5. **Ranges current:** `CLOUDFLARE_IP_RANGES` (or the built-in list) matches cloudflare.com/ips.

After enabling, redeploy and re-run check 3 to confirm identities now come from
`cf-connecting-ip`.
