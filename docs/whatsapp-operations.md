# WhatsApp property operations: deployment and runbook

This covers the official NesAfric WhatsApp number and the autonomous maintenance workflow (onboarding, provider network, tenant reports, routing, dispatch, completion, alerts and digests). Design and progress: `docs/autonomous-property-ops-plan.md`.

Real WhatsApp delivery has **not** been verified end to end. Every test uses a recording adapter instead of Meta. Do not announce the feature as live until the checklist in section 6 is complete.

## 1. Meta setup

1. Create a Meta app (type Business) and connect a WhatsApp Business Account (WABA).
2. Register the official number and note its **phone number ID** and the **WABA ID**.
3. Create a system user with `whatsapp_business_messaging` and `whatsapp_business_management`, and generate a long-lived token.
4. Webhook:
   - Callback URL: `https://<host>/api/webhooks/whatsapp`.
   - Verify token: any long random string, also stored on the official organisation's WhatsApp channel (below).
   - Subscribe to the `messages` field.
5. Submit the templates in section 3 and wait for approval.

## 2. Configuration

### Official organisation

Create an organisation for NesAfric itself and set `WHATSAPP_OFFICIAL_ORGANISATION_ID` to its ID **before** you assign its number. A number assigned to that organisation is recorded as official at the moment of assignment. Then:

1. A platform admin with `whatsapp_numbers.manage` (SUPER_ADMIN only) assigns the number:

   ```
   POST /api/platform-admin/whatsapp-numbers
   { "organisationId": "<official org id>", "phoneNumberId": "<phone number id>", "businessAccountId": "<WABA id>", "reason": "Official NesAfric number" }
   ```

2. As the organisation's owner, save the rest of the channel through `PUT /api/organisations/<id>/communication-channels/WHATSAPP` (or the channel settings screen):

   ```json
   { "enabled": true, "webhookVerifyToken": "<verify token>", "config": { "marketplaceAssistantEnabled": true, "defaultCountry": "GH", "defaultCurrency": "GHS" } }
   ```

### Assignment trust

Every number sends with the same system-user token, so the phone number ID decides who sends as which number. A number in an organisation's channel settings grants nothing. Only an active **assignment** (`WhatsAppNumberAssignment`) does, and only a platform admin creates one.

- **Sending.** Replies, staff messages, notifications and templates use the assigned number. They never use a `phoneNumberId` stored in the channel settings.
- **Receiving.** `/api/webhooks/whatsapp/<orgId>` (and the official `/api/webhooks/whatsapp`) returns `503` when the organisation has no assignment, and accepts only events for the assigned number.
- **Official fallback.** A business-initiated message (reminder, invitation, work order) for an organisation without its own assignment goes from the official number. This needs the official organisation's channel to be enabled with an assignment marked official. Conversation replies never fall back: a reply on a number the organisation does not hold is not sent.
- **Organisations.** The channel update refuses any `phoneNumberId` or `businessAccountId` that differs from what the organisation already has (`403 WHATSAPP_NUMBER_PLATFORM_ASSIGNED`). Leaving them out keeps everything as it is.
- **Database.** Unique indexes allow one active holder per number and one active number per organisation. A check constraint keeps the active columns consistent.

Platform endpoints (all audited; changes need `whatsapp_numbers.manage`, the list needs `communications.read`):

| Endpoint | Body | Effect |
|---|---|---|
| `GET /api/platform-admin/whatsapp-numbers` | | `assignments` in force, `protectedNumbers` (old official numbers), `unreviewedClaims` (legacy numbers, below). |
| `POST /api/platform-admin/whatsapp-numbers` | `organisationId`, `phoneNumberId`, `businessAccountId?`, `move?`, `reason` | Assign, replace or move. Sending the assignment already in force returns `changed: false` and records nothing. |
| `POST /api/platform-admin/whatsapp-numbers/release` | `phoneNumberId`, `confirmPhoneNumberId` (same value), `reason` | End an ordinary assignment, or lift an old official number's protection. |
| `POST /api/platform-admin/whatsapp-numbers/claims/dismiss` | `organisationId`, `phoneNumberId`, `reason` | Reject a legacy claim; the number is removed from that organisation's settings. |

Audit actions: `platform_admin.whatsapp_number_assigned`, `_moved`, `_released`, `platform_admin.whatsapp_claim_dismissed` (platform trail, with the reason). Each organisation affected gets `communication_channel.whatsapp_number_assigned`, `_removed` or `communication_channel.whatsapp_claim_dismissed` in its own log.

### Legacy numbers: review before they work again

Numbers that organisations saved in their channel settings before this change are **unreviewed claims**. From deployment until a platform admin reviews them, they neither send nor receive. Business-initiated messages for those organisations use the official number (if available). Meta keeps retrying the `503` webhook deliveries for a while, so messages sent to those numbers are received once the number is approved, if it is approved soon enough.

1. `GET /api/platform-admin/whatsapp-numbers` and read `unreviewedClaims`. Each claim shows `heldByOrganisationId` (another organisation already has it), `officialProtected` and `claimedByOrganisations` (more than 1 means a conflict).
2. Check the claim against WhatsApp Manager: does the number belong to that business?
3. Approve it with `POST /api/platform-admin/whatsapp-numbers` (the audit records `approvedLegacyClaim: true`), or reject it with `POST …/claims/dismiss`.
4. Work queued under the claim before approval is not sent (see below).

### Moves and replacements

- **Move.** Taking a number from the organisation that holds it is refused (`409 WHATSAPP_NUMBER_IN_USE`) unless the request has `"move": true`. That organisation keeps its channel settings but has no number until it is assigned another.
- **Replace.** Assigning a new number to an organisation ends its old assignment. The audit records the previous number.
- **Queued and in-flight work.** Every WhatsApp delivery and inbound receipt records the assignment it was created under. If that assignment is no longer the organisation's active one when the work runs, the work is **quarantined**:
  - a delivery is marked `SKIPPED` ("The WhatsApp number assignment changed…") and logged as `message.delivery_quarantined`;
  - an inbound message is marked processed with `metadata.quarantined`, gets no reply, and is logged as `whatsapp.inbound_quarantined` (domain event and log line).
  Quarantined work is never retried or resent. A new holder starts its own conversations; it never sees the old holder's transcript.
- **Sends in progress** hold the assignment (shared lock), so a move waits for them to finish (up to about 15 seconds) and nothing goes out from a number after its move commits.
- **Inbound messages being processed** hold it too, from the assignment check through deciding, its side effects (maintenance requests, job replies, rule changes) and queueing the reply. A move waits for that to finish, so no side effect happens for a number that has already moved.
  - All database work of one processing pass runs on the single transaction that holds the lock. Its writes commit together with the lock, or not at all.
  - If the pass runs past `WHATSAPP_PROCESSING_TIMEOUT_MS` (default 120000), or its database connection is lost, the lock is released and every write of the pass is rolled back. Anything the pass still tries afterwards fails.
  - SMS sends (Arkesel) and file uploads first check that the pass's transaction is still alive. The job is then retried and its message quarantined if the number has moved.
- **Conversation provenance.** Every WhatsApp conversation records the assignment it was received under (`Conversation.whatsappAssignmentId`). Staff replies and automatic AI replies go out only while that is still the organisation's active assignment. Otherwise the delivery is `SKIPPED` with a reason saying the conversation came from an assignment the organisation no longer has.
- **Legacy inbox (assistant off).** A message received under a different assignment starts a new conversation; it never continues the old thread.
- **Assistant conversations** are tied to their number. An inbound message on the same number re-verifies the conversation under the current assignment.
- **Missing provenance.** Conversations created before this change have no provenance and get no replies, from staff or AI. The reason is "cannot be verified". They work again only after the customer writes to the current number, which re-verifies an assistant conversation or starts a new legacy one. Provenance is never inferred from the current assignment.
- Re-assigning the official number to promote it creates a new assignment. Official conversations then accept staff replies again once each customer writes in.

### Official number

- An official number never goes to another organisation, even with `"move": true` and even after it has been replaced (`409 OFFICIAL_WHATSAPP_NUMBER`). The official number in use cannot be released (`409 OFFICIAL_WHATSAPP_NUMBER_ACTIVE`).
- **Replacing it:** assign the new number to the official organisation. The old number moves to `protectedNumbers`. Messages queued under the old number are quarantined, and new ones go from the new number.
- **Reusing an old official number elsewhere** (for example after Meta reissues it): `POST …/release` with the number typed twice and a reason. This lifts the protection and is audited. Then assign it normally.
- Changing `WHATSAPP_OFFICIAL_ORGANISATION_ID` does not move anything. Assign the official number to the new official organisation. If that organisation already holds the number, assigning it again promotes the assignment to official. Until then there is no official fallback.

### Recovery

- **Wrong organisation got a number:** move it back with `"move": true` and a reason. Work queued for either organisation in between is quarantined. Tell both organisations to resend anything important.
- **Organisation lost its number by mistake:** assign it again. Quarantined messages stay quarantined; the customer has to write again or staff must start a new message.
- **Official number compromised or lost:** assign a replacement to the official organisation first. Then decide whether the old number should ever be released.
- **Find what was quarantined:** `MessageDelivery` rows with that `failureReason`, audit `message.delivery_quarantined`, domain events `whatsapp.inbound_quarantined`.

### Environment variables

| Variable | Purpose |
|---|---|
| `WHATSAPP_PROVIDER_ACCESS_TOKEN` | System-user token. Without it every send fails closed. |
| `WHATSAPP_GRAPH_API_VERSION` | For example `v21.0`. |
| `WHATSAPP_APP_SECRET` | Checks `X-Hub-Signature-256` on every webhook. Without it the webhook returns 503. |
| `WHATSAPP_OFFICIAL_ORGANISATION_ID` | ID of the official organisation above. |
| `WHATSAPP_TEMPLATE_NOTIFICATION` | `name:language` of the notification template. |
| `WHATSAPP_TEMPLATE_PROVIDER_INVITE` | `name:language` of the invitation template. |
| `WHATSAPP_TEMPLATE_WORK_ORDER` | `name:language` of the work-order template. |
| `ARKESEL_API_KEY`, `ARKESEL_SENDER_ID` | SMS verification codes for account linking and onboarding. |
| `OTP_HASH_SECRET` | At least 32 characters (falls back to `SESSION_SECRET`). |
| `AI_PROVIDER`, `AI_PROVIDER_API_KEY` | Optional. Without them, deterministic rules classify reports and questions. |
| `WHATSAPP_PROCESSING_TIMEOUT_MS` | Optional. Longest one inbound processing pass may hold the number assignment (default 120000). |
| `CRON_SECRET` or `JOBS_RUN_SECRET` | Needed if `/api/jobs/run` is used instead of the worker. |

### Worker

On Vercel, each accepted webhook also processes its own reply path right after answering Meta (`src/platform/jobs/fast-path.ts`; turn off with `WHATSAPP_INLINE_PROCESSING=false`), so replies do not wait for the cron. The `/api/jobs/run` cron still runs everything else (dispatch timeouts, digests, retries). Vercel Hobby runs crons only once a day; use Pro, or an external scheduler, for the 5-minute schedule in `vercel.json`.

Run `npm run worker` continuously, or call `POST /api/jobs/run` at least every minute. Either one:

- drains the job queue (deliveries, assistant replies, routing, dispatch timeouts, alerts, digests);
- schedules daily digests.

Without one of them nothing is answered or sent.

## 3. Templates to submit

All of these are Utility category. Use quick-reply buttons where shown; the replies arrive as `Accept` / `Decline` and are matched to the exact message.

| Key | Body (variables) | Buttons |
|---|---|---|
| NOTIFICATION | `NesAfric update: {{1}}` | none |
| PROVIDER_INVITE | `{{1}} would like to send you {{2}} work orders through NesAfric. Reply ACCEPT to join or DECLINE to refuse. You will only receive jobs you are sent, and can reply STOP at any time.` | Accept, Decline |
| WORK_ORDER | `New job {{2}} from {{1}} at {{3}}: {{4}}. Urgency: {{5}}. {{6}} Please reply by {{7}}.` | Accept, Decline |

Customer text inside templates (organisation names, locations, issue titles) is stripped of links and phone numbers and length-capped before sending.

## 4. Monitoring

`GET /api/platform-admin/health` now includes `automation`:

| Signal | Meaning | Action |
|---|---|---|
| `deadLetterJobs` | Jobs that exhausted retries or failed permanently. | Inspect `lastError`; requeue one attempt with the job retry endpoint after fixing the cause. |
| `unconfirmedDeliveries` | WhatsApp sends whose outcome is unknown (timeout). Never resent automatically. | Check with the recipient; retry from the conversation if needed (they may get it twice). |
| `undeliveredCritical` | CRITICAL alerts with nobody reachable after 5 minutes. Also logged as `maintenance.critical_alert_undelivered`. | Phone the landlord; ask them to link their WhatsApp number. |
| `workOrdersNotSent` | Dispatch attempts that could not be sent in the last 24 hours (missing template, opt-out, no number). | Fix the configuration; the landlord has an escalation. |
| `openEscalations` | Items waiting for a landlord. | None for support, unless a customer asks. |
| `pendingOwnershipClaims` | Properties registered without evidence. | Review (section 5). |

Also alert on log events `whatsapp.webhook.items_skipped` (Meta changed a payload shape) and `whatsapp.status.unmatched`.

## 5. Support tools

- **Investigate a request.**
  - Support: open a support session for the organisation, then `GET /api/platform-admin/organisations/<orgId>/maintenance/<requestId>/timeline`. Every view is recorded in the platform audit trail.
  - Landlord team: the same timeline at `GET /api/maintenance/requests/<requestId>/timeline`.
- **Manual override** (by the landlord's team; history is kept):
  - `POST /api/maintenance/requests/<id>/dispatch` sends the job to a chosen network provider. On WhatsApp: `send NM-1001 to 2` after `providers`.
  - `POST /api/maintenance/requests/<id>/stop-automation` (`stop NM-1001`).
  - `POST /api/maintenance/escalations/resolve` (`resolve NM-1001`).
- **Ownership claims.** List them with `GET /api/platform-admin/portfolio-verifications`. Decide each with `POST /api/platform-admin/portfolio-verifications/<id>` and `{ "status": "VERIFIED" | "REJECTED", "note": "…" }` (needs `portfolio.verify`).

## 6. Go-live checklist

1. Migrations `20261018230000_whatsapp_number_assignments` and `20261019090000_whatsapp_conversation_provenance` applied. The official number assigned through the platform endpoint, and every legacy claim reviewed (section 2).
2. Templates approved and their env vars set; the health check shows `whatsapp: CONFIGURED`.
3. From a real phone, send `hi` and get the menu.
4. Run `link` with a real SMS code.
5. Run `register` end to end, then `confirm`. Check that the organisation, properties and pending ownership claim exist.
6. Run `add provider` to a second real phone, then reply ACCEPT from it.
7. Add a rule with `add rule`.
8. From a tenant phone: send the access code, `report`, a photo, `confirm`. The provider phone receives the work order.
9. On the provider phone: tap Accept, `quote` over the limit, landlord `approve`, `done` with a photo, then the tenant replies `ok`.
10. The digest arrives at the configured hour, and a CRITICAL alert for an emergency report arrives at once.
11. Reply STOP from the provider phone, and confirm the next job does not reach it.

## 7. Known limits

- WhatsApp numbers are assigned by NesAfric support (section 2). There is no embedded signup yet, so a landlord cannot connect their own number without support, and there is no admin screen: the platform endpoints are API-only.
- Legacy numbers stop working at deployment until they are reviewed (section 2). Meta's redelivery of `503` webhooks is time-limited, so review them promptly.
- All numbers share one system-user token; a per-number or per-business token is not supported. Meta itself does not stop a token holder sending as any number on the WABA; the assignment check is in this application only.
- Quarantined messages are not resent automatically.
- A send or upload already started when a processing pass's transaction ends is not recalled. The liveness check runs just before it starts.
- If the database kills the connection of a processing pass (restart, failover, idle killer, `pg_terminate_backend`), Prisma 6.19 never returns that pooled connection: it releases the client only after `ROLLBACK`/`COMMIT` succeeds, and on a dead connection that statement fails. Without a fix the pool loses one connection per kill until the process restarts; once all are lost every query waits forever, and `$disconnect()` never resolves. The application works around this in all its clients with `PrismaPgWithTransactionRelease` (`src/platform/database/pg-adapter.ts`), which releases the client when the closing statement fails. `tests/postgres-pg-adapter-dead-backend.integration.test.ts` reproduces the leak with plain `PrismaPg` and checks the fix: failed `COMMIT` and failed `ROLLBACK` each release the client exactly once, a dead client is discarded and a live one is reused, the caller sees its own error rather than the cleanup failure, killed writes do not survive, and transactions recover after more interruptions than the pool has connections. Normal commits, rollbacks and transaction timeouts are unchanged.
  - Scope: every `PrismaPg` construction site uses it: the application client (`src/platform/database/client.ts`, also used by the worker and `scripts/seed-demo.ts`), `prisma/seed.ts` and `scripts/bootstrap-platform-admin.ts`. The leak also applies to the internal transactions Prisma opens for multi-statement writes (for example nested creates), so scripts are not exempt: with the plain adapter a killed connection would make their final `$disconnect()` hang, and the process would never exit or report the error.
  - Upstream: fixed in Prisma 7.0.0 (`@prisma/client-engine-runtime` releases in a `finally`). 6.19.3 is the last 6.x release and still has the bug; `@prisma/adapter-pg` and `pg` 8.23.1 have no fix of their own because the bug is in the transaction manager. Remove the workaround when upgrading to Prisma 7 or later: first confirm the transaction manager there still releases the client in a `finally` on both the `COMMIT` and `ROLLBACK` paths, then delete `pg-adapter.ts`, switch the construction sites back to `PrismaPg`, and keep the fault-injection tests pointed at plain `PrismaPg`. The two plain-adapter cases in the test file start failing on a fixed Prisma; that is the signal.
  - Pool timeouts are not a fix: `idleTimeoutMillis` does not touch a checked-out client, and `connectionTimeoutMillis` only turns a hang into an error once the pool is exhausted. They are not set.
- After deployment, staff cannot reply to existing WhatsApp conversations until the customer writes again (no provenance).
- A notification send that has already picked the official number as its sender is retried (not quarantined) if the official assignment changes before it sends.
- Rent-due reminders are not configured by onboarding; only lease-expiry policies exist.
- Provider photo access uses short-lived signed links; links are removed from the stored transcript after sending.
- Times are Ghana time (UTC); there is no per-organisation time zone.
