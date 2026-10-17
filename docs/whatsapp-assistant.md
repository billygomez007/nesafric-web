# NesAfric WhatsApp assistant

NesAfric's own WhatsApp Business number becomes a conversational front door to the existing
platform. Customers find properties and service professionals; agents, agencies, developers,
landlords and service providers register and submit listings — all through the **existing**
NesAfric services and tables. WhatsApp only adds a transport and resumable conversation state.

> **Status: not production-ready.** Everything below is verified with automated tests against
> Postgres and a faked Meta Graph API. Nothing has been exercised against a real WhatsApp number,
> Meta webhook, Arkesel SMS or production infrastructure. See [Acceptance checklist](#real-number-acceptance-checklist).

This is separate from the per-organisation tenant inbox (`/api/webhooks/whatsapp/[organisationId]`,
`src/modules/conversations`), which is unchanged.

## How the blueprint maps onto the existing platform

| Component | Where it lives |
| --- | --- |
| WhatsApp transport | `src/modules/whatsapp-assistant/cloud-api.ts` (parse, send, media, signatures), `ingest.ts`, route `src/app/api/webhooks/whatsapp-assistant/route.ts` |
| Conversation engine | `engine.ts` (commands, menu, routing, pause/resume, account verification), `nlu.ts` (deterministic understanding), `ai.ts` (optional AI via the existing `AI_PROVIDER`) |
| Workflows | `workflows/*.ts`, `form.ts` (guided resumable forms), `state.ts` (durable session state) |
| Processing & recovery | `processor.ts` (per-contact fenced lease), `actions.ts` (exactly-once actions), `recovery.ts` (stalled-work sweep), `store.ts` |
| Identity | Existing `User`; `WhatsAppContact.userId` set only after the website's SMS code (`identity.ts`) |
| Agencies, agents, developers, landlords | Existing `MarketplaceProfessional` (`createMarketplaceProfessional`, `submitMarketplaceVerification`) |
| Service providers | Existing `ServiceProvider`, `ProviderMarketplaceProfile`, `ProviderEvidence` |
| Listings & drafts | Existing `Listing` + `MarketplaceAsset` (`createMarketplaceNativeListing`, `updateMarketplaceNativeListing`, `submitMarketplaceListingForReview`) |
| Media | Existing upload pipeline (`uploadMarketplaceListingMedia`, `uploadProviderEvidenceDocument`, `uploadServiceProviderLogo`) |
| Search | Existing `searchPublicListings` (+ `area`, `furnishing` filters) and `discoverMarketplaceProviders` |
| Inquiries, viewings, quotes | Existing `createMarketplaceLead`, `createViewingRequest`, `createMarketplaceEnquiry` |
| Moderation | Existing platform-admin decisions; each now writes a WhatsApp notification to an outbox **in its own transaction** (`notification-outbox.ts`) |
| Admin | `/platform-admin/whatsapp` (metrics from recorded events, support queue, failures, WhatsApp submissions) |

## What people can do

1. **Find a property** by typing naturally ("2-bedroom apartment in East Legon, around 4k"). Only verified, published, available listings, three at a time, with photo, price, location, verification label, reference and real public URL. Zero results are reported honestly with ways to broaden; a technical failure is never shown as "no results".
2. **Ask about a property / request a viewing** — answers come only from the listing record; the question becomes a lead for the agent. Viewings are "requested, not confirmed" until the agent confirms; the customer is told on WhatsApp when they do. No account needed.
3. **Find a service provider** and **request a quote** (verified providers accepting work only). Needs a verified account (SMS code).
4. **Register a real-estate business** (agency/brokerage, marketing company, developer, property management, independent agent, landlord) → `MarketplaceProfessional` in the verification queue. Needs the SMS code. An agent naming an agency gains nothing; the agency's admins are told.
5. **Register a service business / professional** → `ServiceProvider`, unlisted until a platform reviewer approves; Ghana Card stored `PRIVATE`. Needs the SMS code.
6. **List a property** (requires an active membership of a business profile) → draft, photos (main photo first = cover), AI-assisted copy built only from what was said and confirmed by the person, then submit for review. Nothing is public until a platform reviewer approves.
7. **Check status**, fix and resubmit returned listings, pause & edit, mark rented/sold, withdraw.
8. **Talk to support** → `WhatsAppSupportRequest` for the admin dashboard.

Commands: `menu`, `resume`, `cancel`, `status`, `support`, `help`, `link account`, `stop`/`start`.

## Account linking (ownership verification)

The sender's WhatsApp id (from Meta's signed webhook) is **never** enough to act as an account, and
nothing typed in a message ever is. The first time a step needs an account (registration, quote
request, or `link account`), the assistant sends the **website's own SMS sign-in code**
(`requestOtp`/`verifyOtp`, Arkesel-backed, with its rate and attempt limits) to the sender's number:

- the correct code links an existing account with that verified phone, or creates one with the phone verified *by that code* (preserving the `User.phoneE164` invariant);
- a wrong code links nothing; the step that needed the account is replayed only after success;
- an account with a `PlatformPrincipal` (staff) is never linked;
- if SMS isn't configured or is rate-limited, nothing is created and the person is told.

Customers who only search, ask about a listing or request a viewing never need an account.

## Durability and recovery

| Concern | Mechanism | Evidence (tests) |
| --- | --- | --- |
| Signature | HMAC-SHA256 over the **exact raw bytes** with `WHATSAPP_APP_SECRET`; missing secret → 503 (fail closed) | forged/unsigned/replayed/tampered, non-ASCII bytes |
| Scoping | Only events whose `phone_number_id` = `WHATSAPP_PHONE_NUMBER_ID` (required; else 503) and, when set, `entry.id` = `WHATSAPP_BUSINESS_ACCOUNT_ID` | other number/account ignored |
| Ack after persistence | The inbound row **and** its processing job commit in one transaction before the 200 | atomic insert test |
| `after()` is only acceleration | If it never runs, the per-message job (`/api/jobs/run` or `npm run worker`) processes the message | "after() never runs" test |
| Process death / stranded jobs | `recoverStalledWhatsAppWork` (runs on every `/api/jobs/run` and worker tick) re-processes inbound messages and flushes outbound rows idle > 2 min, independent of `BackgroundJob` state (the generic runner never re-claims `RUNNING` jobs) | stranded `RUNNING` job test |
| Duplicates | Unique Meta message id; a redelivery of a still-pending message re-arms its job | concurrent duplicates, redelivery after lost ack |
| Ordering & concurrency | Per-contact lease; messages processed oldest-first | 5-message burst under 5 concurrent workers |
| Stale workers | Lease **fencing token**: claim, extend, release and commit are all conditional on it; a worker that stalled past its lease commits nothing | stalled-worker test (replacement's result stands, one reply set) |
| Irreversible actions | `runOnce` keyed by the triggering message. In-flight attempt (< 5 min) → message deferred 2 min without spending an attempt. Older `STARTED` attempt → reconciled against real records: found → completed (no duplicate); provably absent → re-run (no permanent suppression) | guard unit tests + in-doubt e2e |
| Repeated failures | 3 attempts → honest apology, progress kept, support request opened; attempts exhausted by crashes are escalated the same way | existing tests |
| Business-rule refusals | A 4xx from a domain service (permission revoked, record gone, invalid state) answers from the pre-step state; not retried | revoked-membership test |

**Reconciliation keys.** Leads and viewings: exact (`Idempotency` binding stored with the row).
Service requests: exact (a `ref` tag in the message). Registrations, provider profiles and listing
drafts: the same actor + the same name/title, created after the attempt started (30 s clock margin);
listing submission: the listing reached `PENDING_REVIEW` after the attempt started. The 5-minute
staleness threshold assumes no worker runs longer than the 2-minute lease plus the 60-second
request limit; a self-hosted `npm run worker` with a stuck DB call longer than that could in
principle complete after reconciliation — bounded by Prisma's 30 s transaction timeouts.

### Outbound sends and ambiguous outcomes

Replies and notifications are idempotent rows sent strictly in order per contact.

- **Success** → `SENT` (then `DELIVERED`/`READ` from status webhooks, which never move backwards).
- **Permanent failure** (4xx, non-retryable Meta codes, e.g. 131047 outside window) → `FAILED`, recorded, never retried.
- **Retryable failure** (429, 5xx, network, timeout) → stays `QUEUED`, retried with backoff (30 s × 2ⁿ, up to 5 attempts); later messages wait so nothing overtakes.
- **Ambiguous** (timeout, dropped connection, 5xx — Meta may already have accepted it) → labelled `AMBIGUOUS…` in `lastError` and **retried anyway**. Policy: a possible duplicate informational message is preferable to a lost confirmation or reference number. Retrying a send never re-runs the business step that produced it.

### Notifications and the 24-hour window

Review decisions (listing published / changes requested / rejected; business verified / rejected /
suspended; provider identity decided) and viewing confirmations write a notification job **in the
same transaction** as the decision. It can't roll the decision back (duplicates are skipped) and
can't vanish after commit: it is delivered immediately after commit, and the job runner retries it
if that fails or never happens. "Your listing is live" is only sent after the public-eligibility
check confirms visibility.

Outside the 24-hour customer-service window:

- with `WHATSAPP_STATUS_TEMPLATE_NAME` set → sent as that approved template (one body variable);
- without it → recorded as `SKIPPED` with reason `OUTSIDE_WINDOW: …` and **automatically released** (sent first) the next time the person messages, if within 7 days; visible in the admin outbound counts;
- opted-out contacts (`stop`) → `SKIPPED` with `OPTED_OUT: …`, never released — this applies to staff support replies too. Replies to the person's own messages are always sent.

## Security model (summary)

- Account linking needs the SMS code (above); staff accounts can't be linked.
- Every action goes through the domain services' own permission checks at execution time, including resumed workflows (a revoked membership is refused and the workflow ends).
- Another agency's listings are never shown or editable, even with forged option ids.
- No WhatsApp step can publish; only platform reviewers can (the service also refuses).
- AI output is limited to a closed intent enum and listing copy that is schema-validated and fact-checked; it can't select a user, organisation, record or action.
- Media: the access token is only sent to `https` Meta media hosts (`WHATSAPP_MEDIA_HOSTS`), redirects are refused, downloads are time-limited and streamed with a hard byte cap; then the existing upload pipeline sniffs content, applies type/size rules, scans for malware and stores privately or publicly by target. Identity documents are `PRIVATE`, have no URL, and the storage route requires a valid signed token.
- Logs carry only error class/code and ids (`log.ts`, guarded by a test); the webhook route does not use the generic error logger.
- Admin views mask phone numbers and never list message bodies; support replies need `whatsapp_support.manage` and are audited.

## Migrations and their impact

| Migration | What it does | Impact on an existing database |
| --- | --- | --- |
| `20261017115000_business_whatsapp_fk_name` | Renames one foreign key on `BusinessWhatsAppVerificationChallenge` to Prisma's default name | Catalog-only rename, no rewrite or data change; brief lock on that table |
| `20261017120000_whatsapp_assistant` | 7 new tables + 4 enums; nullable `sourceChannel` on `Listing`, `MarketplaceProfessional`, `ServiceProvider` | New tables; adding nullable columns without defaults is metadata-only in Postgres |

**Pre-existing drift fixed (schema-side).** On `main`, `prisma/schema.prisma` declares
`BusinessWhatsAppConfig.id/organisationId/serviceProviderId` as `TEXT`, but its migration created
`UUID` columns, and Postgres truncated two constraint/index names. Runtime is unaffected (verified:
`main`'s client reads and writes these rows), but `prisma migrate diff` reports drift, the repo's
fresh-database bootstrap fails its drift check, and `prisma migrate dev` would generate an invalid
migration (TEXT columns can't reference UUID keys). This branch declares the real types
(`@db.Uuid`) and the real index names (`map:`), plus the FK rename above (Prisma can't express a FK
and an index sharing one truncated name). Result: zero drift, verified on a fresh database and on
a `main` database with existing data.

**Pre-existing, not fixed here:** `prisma migrate deploy` on an *empty* database fails on `main`
(phase23/phase25 ordering — see `docs/FRESH_DATABASE_BOOTSTRAP.md`), so the CI workflow's migrate
step can't pass on a fresh Postgres; use `scripts/bootstrap-fresh-database.sh` for new databases.
Existing databases use `prisma migrate deploy` as normal.

## Setup

External/dashboard steps (none can be done from the code):

1. **Database**: `npm run db:deploy` (review the two migrations above first).
2. **Meta Business Manager**: create the app with the WhatsApp product, add and verify NesAfric's number, complete business verification, set a display name.
3. **System User token** with `whatsapp_business_messaging` and `whatsapp_business_management` (permanent).
4. **Environment** (see `.env.example`): `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`; keep `WHATSAPP_ASSISTANT_ENABLED="false"` until the checklist passes.
5. **Webhook**: callback `https://<domain>/api/webhooks/whatsapp-assistant`, verify token as above, subscribe to the `messages` field.
6. **Template**: create and get approved a *utility* template with one body variable (e.g. "NesAfric update: {{1}}"), set `WHATSAPP_STATUS_TEMPLATE_NAME`/`_LANGUAGE`.
7. **SMS (Arkesel)**: `ARKESEL_API_KEY` and an approved `ARKESEL_SENDER_ID` — required for account linking; without them registrations and quote requests stop at verification (by design).
8. **Background work**: `CRON_SECRET` set so the Vercel cron in `vercel.json` (`*/5 * * * *` → `/api/jobs/run`) is accepted. Vercel's Hobby plan only allows daily crons — sub-daily schedules need Pro, or run `npm run worker`, or an external scheduler calling `POST /api/jobs/run` with `JOBS_RUN_SECRET`. Without one of these, recovery relies on `after()` alone.
9. Optional AI: `AI_PROVIDER`/`AI_PROVIDER_API_KEY`; `WHATSAPP_ASSISTANT_AI="off"` disables it.

## Real-number acceptance checklist

To be executed later by the team on a staging deployment with a test number (no production data):

- [ ] Webhook verification handshake succeeds in Meta's dashboard; a wrong verify token is rejected.
- [ ] A signed test event is accepted; an event with a modified body is rejected (401) — check logs contain no message text.
- [ ] Message from an unregistered phone → menu; a property search returns only published listings with working links and images rendering in WhatsApp.
- [ ] Interactive buttons and list replies arrive with the expected ids; typed numbers select options.
- [ ] Inquiry + viewing request appear in the agent's inbox; agent confirms → customer receives the confirmation.
- [ ] Registration: SMS code arrives from the approved sender ID; wrong code rejected; correct code links; an existing website account with the same phone is linked, not duplicated.
- [ ] Listing with 3+ photos from a real phone (JPEG/HEIC): photos stored, cover correct, nothing public before approval; Meta media URLs not stored.
- [ ] Admin requests changes → WhatsApp message received; edit & resubmit; admin publishes → message with working public URL.
- [ ] Provider registration with a Ghana Card photo: document only visible to reviewers; approval lists the profile.
- [ ] Notification more than 24 h after the last message: delivered via the approved template; with the template unset, recorded as skipped and delivered after the person writes again.
- [ ] `stop` then a review decision → nothing sent; `start` re-enables.
- [ ] Kill the process during a reply (or disable `after()`): message answered by the next cron/worker run within ~5 minutes.
- [ ] Meta status webhooks update outbound rows to delivered/read; a failed send appears in the admin dashboard.
- [ ] Load: a burst from several phones at once is answered in order per phone without duplicates.
- [ ] Rotate the access token and app secret; confirm the old secret is rejected.

## Test evidence

Unit and Postgres integration tests (Meta Graph API faked, SMS faked, no real messages):

- `whatsapp-assistant-nlu.unit.test.ts` — language parsing, references, copy faithfulness, Cloud API parsing/signatures, interactive limits.
- `postgres-whatsapp-assistant.integration.test.ts` — customer discovery, inquiry, viewing, duplicates.
- `postgres-whatsapp-business.integration.test.ts` — registration (with SMS code), listing with photos, corrections, resubmission, publication, isolation, pause/resume, affiliation claims.
- `postgres-whatsapp-services-security.integration.test.ts` — services, provider registration, webhook forgery, retries, prompt injection, window/opt-out, support & admin permissions.
- `postgres-whatsapp-durability.integration.test.ts` — atomic ack, after() never runs, stranded jobs, redelivery, concurrent duplicates, bursts, lease fencing, stalled worker, action guard.
- `postgres-whatsapp-security-boundaries.integration.test.ts` — SMS-verified linking, staff accounts, revoked membership on resume, cross-agency, publication, private documents, AI limits, media hardening, opt-out, logging.
- `postgres-whatsapp-notifications-webhook.integration.test.ts` — transactional outbox, recovery delivery, rollback, deferred-window release, scoping, raw-byte signatures, search eligibility.
- `postgres-whatsapp-load.integration.test.ts` — bounded concurrency (40 contacts by default; `WA_LOAD_CONTACTS` to change).

**Measured locally (4 vCPU sandbox, local Postgres, faked Meta API — not a production capacity
claim):** 150 simultaneous conversations × 5 messages, every delivery duplicated (1,500 webhook
deliveries) with two overlapping workers per contact: all processed exactly once, in order; ingest
≈ 200 deliveries/s, processing ≈ 50 messages/s, 1,200 replies sent.

## Deferred requirements and known limitations

- Not verified against real Meta/Arkesel/production infrastructure (checklist above).
- No production load test; real throughput depends on Meta rate limits, DB pool and function concurrency.
- Agency/landlord verification uses evidence *references* (registration number, declared authority), matching current platform policy; document upload for real-estate businesses is not implemented on WhatsApp.
- Photos only for listings (no video); up to 12, as on the website.
- A company service provider gets a regular organisation (as website onboarding requires), which starts its standard trial subscription.
- Approved providers still switch on "accepting work" in their dashboard before receiving quote requests.
- Amenity answers in inquiries are keyword-based; anything not on the listing is passed to the agent.
- Ambiguous outbound sends may produce a duplicate informational message (policy above).
- The generic job runner never re-claims jobs left `RUNNING` by a crashed process; the assistant's own sweep covers its work, other job types are unaffected by this change.
- Data retention/deletion for WhatsApp messages is not automated yet (inbound/outbound rows are kept); define a retention period before launch.
