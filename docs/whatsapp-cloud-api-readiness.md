# WhatsApp Cloud API: production readiness (2026-10-25)

Official number **+233 50 282 0002** (phone number id `1304923409378538`, WABA `1104581892174096`).
Production: Cloud Run `nesafric-web` (europe-west1, project `nesafric-production`), Cloud SQL
`nesafric-prod-db`, database `nesafric`. Webhook: `https://www.nesafric.com/api/webhooks/whatsapp`.

This document is the audit, the gap report, the deployment plan and the go-live checklist for this
branch (`feat/whatsapp-cloud-api-completion`). Related: `docs/whatsapp-operations.md` (configuration
and templates), `docs/whatsapp-live-test-runbook.md` (phone tests), `docs/whatsapp-shopping-audit.md`
(shopping assistant), PR #46 (WhatsApp Flows, not merged).

## 1. Audit: what production does today

Read-only checks on 2026-10-25 (Cloud Run describe, Cloud Logging, HTTP probes; nothing changed).

| Check | Result |
|---|---|
| Deployed revision | `nesafric-web-00004-zlt`, image `web:e0f2bea` (main at PR #45) |
| `GET` verification | Verified: 200 with the exact challenge for the stored token, 403 for a wrong token |
| `POST` events | **Broken: every delivery gets `503 WhatsApp webhook is not configured`.** `WHATSAPP_APP_SECRET` is in Secret Manager but is not mounted on the service, so the handler refuses before checking the signature. |
| Outbound sends | **Broken: `WHATSAPP_PROVIDER_ACCESS_TOKEN` is not mounted either.** Every send would fail closed ("WhatsApp delivery is not configured"). |
| Flows key | `WHATSAPP_FLOWS_PRIVATE_KEY` exists in Secret Manager, not mounted (only needed with PR #46). |
| Secret access | The runtime service account already has `secretAccessor` on all three WhatsApp secrets. |
| Meta deliveries | Cloud Run logs since 2026-10-18 show **no POST from Meta**, only GET verifications. Either the number's callback still points to another app (the 2026-10-20 runbook found `api.koraafric.com`), or the `messages` field is not subscribed. To be confirmed by the Meta audit below. |
| CPU throttling | **On.** `deploy/cloud-run/setup.sh` asks for `--no-cpu-throttling`, which the reply fast path needs (it runs after the 200). With throttling, replies wait for the 5-minute scheduler. |
| Worker | Cloud Scheduler `nesafric-jobs-run` calls `/api/jobs/run` every 5 minutes: enabled. |
| Scaling | max 5 instances, concurrency 40, 1 CPU, 1 GiB, timeout 300 s. |
| Alerting | No Cloud Monitoring alert policies exist. |
| Official organisation | `WHATSAPP_OFFICIAL_ORGANISATION_ID` is set; its channel config holds the verify token. |

Still to read (needs the Meta token and the database, run `wa-audit.sh`, which only reads): phone
number status and quality, the webhook routing (`webhook_configuration`, subscribed apps and
overrides), template statuses, Flow statuses and validation errors, inbound and delivery counts,
failed and dead-letter jobs, pending migrations, and the count of published, verified listings.

## 2. What already works in code (reused, not rebuilt)

- **Webhook:** raw-body `X-Hub-Signature-256` check with the app secret (constant-time), 1 MiB cap,
  401 on a bad signature, unknown items acknowledged so Meta does not redeliver them.
- **Durable receipt:** each message is stored once (unique Meta message id per organisation) with
  its job in one transaction, under a per-sender advisory lock. Redeliveries are no-ops.
- **Asynchronous processing:** `whatsapp-assistant-message` jobs, ordered per conversation, with an
  optimistic commit; replies are separate `conversation-message-delivery` jobs.
- **Retries:** exponential backoff for messaging jobs, `DEAD_LETTER` after the last attempt,
  operator requeue. 429 and 5xx from Meta are retried; other rejections are not.
- **Statuses:** `sent`, `delivered`, `read` and `failed` update the delivery or notification, in
  order only, with a 15-minute window for statuses that race the send response.
- **Limits:** 20 messages a minute per conversation; free-form replies only inside the 24-hour
  window; templates outside it; STOP and START opt-out.
- **Marketplace:** property search, details, inquiry and viewing request use the listings domain
  (`PUBLISHED` and `VERIFIED` listings only) with its idempotency keys. Nothing is invented: no
  results means "no published, available properties match".
- **Business flows:** agency, agent and service-business registration, property and service
  listings with photos, all through NesAfric review.
- **Identity:** a WhatsApp number alone grants nothing. Account data needs a link verified by an
  SMS or email one-time code; codes are removed from the transcript.
- **Maintenance:** tenant reports, provider job actions, landlord approvals, all permission-checked.
- **Templates:** 30 utility templates with a validator, Meta sync and guarded submission
  (`npm run whatsapp:templates`).

## 3. Gaps and what this branch changes

| # | Gap | Change |
|---|---|---|
| 1 | Production webhook returns 503 (secrets not mounted) | **Infrastructure, needs approval:** mount the two secrets (section 5). No code change. |
| 2 | CPU throttling delays replies by up to 5 minutes | **Infrastructure, needs approval:** `--no-cpu-throttling` (section 5). |
| 3 | Meta does not deliver to NesAfric | **Meta configuration, needs approval:** point the number (or WABA) callback at NesAfric and subscribe `messages` (section 5), after the audit confirms the current routing. |
| 4 | Welcome was long and impersonal | **Code:** `welcome.ts`. A greeting for the time in Ghana (Africa/Accra: morning 05:00–11:59, afternoon 12:00–16:59, evening otherwise) with the first name from the linked account, else the WhatsApp profile name; never a number, email or placeholder. Then a three-line welcome and a "Choose an option" list (one message, 10 rows, Meta's maximum). The stored fallback text also lists the options by number. |
| 5 | Menu options | **Code:** 1 Find a Property (then rent, buy, land, commercial or a viewing), 2 Manage My Properties (`account`), 3 List a Property, 4 Register as an Agent, 5 Register Services, 6 Landlord or Property Manager (`register`), 7 Find Property Services, 8 My Applications, 9 Help & Support, and More options (agency registration, find an agent, list my services, link, status). Every row is a command the existing flows already handle. |
| 6 | No way to find an agent on WhatsApp | **Code:** verified, active agents and agencies whose service areas match, three at a time, profile links only (no phone numbers in chat). Under More options. |
| 7 | Navigation | **Code:** `back` returns to the menu (the current task is saved), `restart` cancels it, `menu`, `resume`, `cancel` and `support` as before. An unrecognised message gets the welcome instead of a dead end. |
| 8 | Numbers | A bare number is a main-menu choice when nothing is being typed (results use `details 2`); registration also works by its words (`register agency`, `register agent`, `register services`, `register`). |
| 9 | WhatsApp Flows | **Not in this branch.** PR #46 holds them; they need the Meta token, a key pair and approval before upload and publication. |
| 10 | Alerting | Recommended policies in section 6; not created (needs approval). |

## 4. Tests

See the final report in the pull request for the commands and results.

## 5. Deployment plan (each step needs explicit approval)

Order matters: the service must accept signed events before Meta starts sending them.

1. **Merge this branch to `main`.** Cloud Build builds, migrates (no new migrations in this branch)
   and rolls out a new revision. Rollout does not change settings or secrets.
2. **Mount the WhatsApp secrets and turn CPU throttling off** (one new revision):
   ```bash
   gcloud run services update nesafric-web --project nesafric-production --region europe-west1 \
     --update-secrets=WHATSAPP_APP_SECRET=WHATSAPP_APP_SECRET:latest,WHATSAPP_PROVIDER_ACCESS_TOKEN=WHATSAPP_PROVIDER_ACCESS_TOKEN:latest \
     --no-cpu-throttling
   ```
   Check: an unsigned `POST` now returns **401** (signature check), not 503; `GET` verification still 200.
3. **Optional live-test gate:** set `WHATSAPP_INBOUND_ALLOWLIST` to the test numbers first
   (`--update-env-vars`), so only those senders are processed. Remove it to open to everyone.
4. **Meta:** point the callback for number `1304923409378538` (or the WABA) to
   `https://www.nesafric.com/api/webhooks/whatsapp` with the existing verify token, and subscribe
   the `messages` field (and `message_template_status_update`). Check that the Kora owner has agreed
   if the number is moved away from the Tap & Order app.
5. Run the acceptance checklist (section 7) from an allowlisted phone.

## 6. Rollback

- **Code:** `gcloud run services update-traffic nesafric-web --to-revisions=<previous revision>=100`
  (the previous revision is `nesafric-web-00004-zlt` today). No schema change to undo.
- **Secrets and CPU:** `--remove-secrets=WHATSAPP_APP_SECRET,WHATSAPP_PROVIDER_ACCESS_TOKEN` returns
  the webhook to 503; Meta keeps retrying for up to 7 days, so nothing is lost while it is off.
- **Meta routing:** restore the previous callback override.
- **Stop replies without losing receipts:** set `marketplaceAssistantEnabled` off in the official
  channel config, or hand conversations to staff (`HUMAN_ACTIVE`).

Recommended alerts: webhook 5xx rate above 1% for 10 minutes; any `DEAD_LETTER` job of type
`whatsapp-*` or `conversation-message-delivery`; pending `whatsapp-assistant-message` jobs older
than 10 minutes; Meta quality rating below GREEN.

## 7. Customer acceptance checklist (allowlisted test phone)

1. Send `Hi` to +233 50 282 0002: the welcome list arrives within seconds.
2. Cloud Run log shows `POST /api/webhooks/whatsapp` 200; the message is stored once.
3. Tap **Property to rent**, send an area, a budget: real listings or "no published, available
   properties match".
4. `details 1`, then `view 1`, a name, `tomorrow 2pm`, `confirm`: a lead and a viewing request
   appear in the listing team's inbox; `status` shows them.
5. Tap **Find an agent**, send an area: verified agents with profile links, or none.
6. Tap **Help & support**: the conversation is in the staff support queue.
7. Redeliver the same webhook (Meta retry or replay): no second message, lead or viewing.
8. Send a request with a wrong signature: 401, nothing stored.
9. Stop the worker briefly or make a send fail with 5xx: the job retries with backoff and the reply
   arrives once.
10. `STOP` and `START`: opt-out recorded and lifted.
