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

Create an organisation for NesAfric itself and set `WHATSAPP_OFFICIAL_ORGANISATION_ID` to its ID. Then:

1. A platform admin with `whatsapp_numbers.manage` (SUPER_ADMIN only) assigns the number:

   ```
   POST /api/platform-admin/whatsapp-numbers
   { "organisationId": "<official org id>", "phoneNumberId": "<phone number id>", "businessAccountId": "<WABA id>", "reason": "Official NesAfric number" }
   ```

2. As the organisation's owner, save the rest of the channel through `PUT /api/organisations/<id>/communication-channels/WHATSAPP` (or the channel settings screen):

   ```json
   { "enabled": true, "webhookVerifyToken": "<verify token>", "config": { "marketplaceAssistantEnabled": true, "defaultCountry": "GH", "defaultCurrency": "GHS" } }
   ```

### WhatsApp numbers are assigned by NesAfric

Every number sends with the same system-user token, so the phone number ID decides who sends as which number. Only the platform sets it:

- **Organisations.** The channel update refuses any `phoneNumberId` or `businessAccountId` different from the assigned one (`403 WHATSAPP_NUMBER_PLATFORM_ASSIGNED`). Leaving them out keeps the assigned values.
- **Assign.** `POST /api/platform-admin/whatsapp-numbers` assigns a number to any organisation, including a landlord's own number. Replacing a number records the old one.
- **Move.** A number belongs to one organisation at a time. Taking it from another organisation is refused (`409 WHATSAPP_NUMBER_IN_USE`) unless the request has `"move": true`. The organisation that loses it has its WhatsApp channel disabled.
- **Official number.** The official number never moves off the official organisation (`409 OFFICIAL_WHATSAPP_NUMBER`). Change `WHATSAPP_OFFICIAL_ORGANISATION_ID` first if it really must move.
- **Audit.** Each assignment or move writes `platform_admin.whatsapp_number_assigned` or `platform_admin.whatsapp_number_moved` to the platform audit trail with the reason. The organisations involved get `communication_channel.whatsapp_number_assigned` or `communication_channel.whatsapp_number_removed` in their audit log.
- **Review.** `GET /api/platform-admin/whatsapp-numbers` (needs `communications.read`) lists every assigned number and its organisation.

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
| `CRON_SECRET` or `JOBS_RUN_SECRET` | Needed if `/api/jobs/run` is used instead of the worker. |

### Worker

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

1. Templates approved and their env vars set; the health check shows `whatsapp: CONFIGURED`.
2. From a real phone, send `hi` and get the menu.
3. Run `link` with a real SMS code.
4. Run `register` end to end, then `confirm`. Check that the organisation, properties and pending ownership claim exist.
5. Run `add provider` to a second real phone, then reply ACCEPT from it.
6. Add a rule with `add rule`.
7. From a tenant phone: send the access code, `report`, a photo, `confirm`. The provider phone receives the work order.
8. On the provider phone: tap Accept, `quote` over the limit, landlord `approve`, `done` with a photo, then the tenant replies `ok`.
9. The digest arrives at the configured hour, and a CRITICAL alert for an emergency report arrives at once.
10. Reply STOP from the provider phone, and confirm the next job does not reach it.

## 7. Known limits

- WhatsApp numbers are assigned by NesAfric support (section 2). There is no embedded signup yet, so a landlord cannot connect their own number without support.
- Numbers saved by organisations before assignment became platform-only still send. Review them with `GET /api/platform-admin/whatsapp-numbers` and reassign or move any that look wrong.
- All numbers share one system-user token; a per-number or per-business token is not supported.
- Rent-due reminders are not configured by onboarding; only lease-expiry policies exist.
- Provider photo access uses short-lived signed links; links are removed from the stored transcript after sending.
- Times are Ghana time (UTC); there is no per-organisation time zone.
