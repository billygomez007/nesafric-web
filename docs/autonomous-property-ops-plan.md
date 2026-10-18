# Autonomous property operations: architecture map and phased plan

Status (2026-10-17): phases 0 and 1 are implemented on `feat/autonomous-property-ops`; phases 2-8 are not started. See section 5.

## 1. What already exists (reuse, do not duplicate)

| Concern | Existing building block | Location |
|---|---|---|
| Landlord account | `Organisation` (type `INDIVIDUAL_LANDLORD` / `PROPERTY_MANAGEMENT`), `OrganisationMember`, `Role`/`Permission` RBAC | `prisma/schema.prisma` ~989-1163, `src/platform/authorization/permissions.ts` |
| User identity | `User.phoneE164`, `phoneVerifiedAt`, passwordless OTP (`AuthOtpChallenge`, email/SMS via Arkesel) | `src/modules/identity/otp.ts` |
| Portfolio | `Portfolio`, `Property` (per-org `referenceNumber`), `Building`, `Unit` | schema ~1181-1310 |
| Tenancy | `Tenant` (person), `TenantOrganisation` (per-org record + channel consent), `Lease`, `TenantAccessInvitation` (hashed access code) | `src/modules/tenants`, `src/modules/leases` |
| Maintenance | `MaintenanceRequest` + history/attachments/approvals, `WorkOrder` + history, state machine | `src/modules/maintenance/service.ts` |
| Providers | `ServiceProvider` (verification, availability, categories, areas), `ProviderOrganisation` (landlord private directory with `priority`, `isBackup`), quotations, `ProviderAssignment` | `src/modules/providers/service.ts` |
| Dispatch | `MaintenanceDispatchAttempt`, `resolveProviderHierarchy`, `proposeDispatch`, `recordProviderResponse` (voice path only) | `src/modules/maintenance-dispatch/service.ts` |
| Automation policy | `AIAutonomyConfiguration`, `AIAutonomyPolicy` (levels, monetary threshold, escalation minutes) | `src/modules/ai-autonomy` |
| WhatsApp | Per-org webhook, HMAC check, inbound dedup on `Message(organisationId, channel, externalMessageId)`, delivery status, 24h window check, template support in adapter, assistant state machine on `Conversation.assistantState` (uncommitted) | `src/app/api/webhooks/whatsapp/[organisationId]`, `src/modules/conversations/channels`, `src/modules/whatsapp-assistant` |
| Business WhatsApp numbers | `BusinessWhatsAppConfig` with opt-in and SMS-OTP verification for provider numbers | `src/modules/business-whatsapp` |
| Jobs | `BackgroundJob` with idempotency key, retries, backoff; worker loop and `/api/jobs/run` | `src/platform/jobs`, `scripts/run-worker.ts` |
| Storage | `StorageObject` + adapters (memory/local/GCS/S3), private-by-default, malware scan status | `src/platform/storage`, `src/modules/documents` |
| Audit | `AuditEvent` (append-only), `DomainEvent`, `PlatformAuditEvent` | `src/modules/audit` |

## 2. Gaps against the target

1. No consent or invite state on `ProviderOrganisation`; landlords add providers unilaterally. `priority`/`isBackup` cannot be set through any API.
2. No routing-rule model (category/property/unit scope, auto-dispatch flag, spending cap, timeout, retries, escalation recipient).
3. No response-timeout sweeper; backup escalation only via a manually triggered voice route with marketplace fallback hard-coded on.
4. Dispatch acceptance and `ProviderAssignment` are two parallel acceptance models.
5. No ticket reference (`NM-1042`) or per-org counter.
6. `Notification` is tenant/lease-centric; it cannot target landlord staff or providers. No severity levels and no daily digest.
7. WhatsApp: no landlord onboarding, tenant maintenance intake or provider job actions; no channel identity link; media not downloaded; no outbound interactive messages; templates never used.
8. Known defects in the current uncommitted WhatsApp work (fix in phase 0):
   - strict envelope parsing returns non-2xx on unknown shapes, so Meta retries and may disable the webhook;
   - a send timeout is retried, which can duplicate a message;
   - permanent failures (window closed, not configured) are retried;
   - handed-off/closed conversations are muted forever;
   - the LLM call runs inside a 45 s DB transaction;
   - WhatsApp reminders from `notifications` now always fail (no `phoneNumberId`, window, or template);
   - status callbacks for `Notification` sends never match a `MessageDelivery` and exhaust retries;
   - no STOP/opt-out handling.
9. No dead-letter state for jobs and no recurring scheduler inside the app.

## 3. Key design decisions

- **One official NesAfric number.** A platform-level WhatsApp channel (one `phoneNumberId`) serves landlords, tenants and providers. Inbound events resolve the sender to a `ChannelIdentity` and then to the right organisation(s). Per-organisation numbers keep working through the existing route.
- **`ChannelIdentity`** (new): `(channel, address)` linked to `User`, optionally `ServiceProvider`, with `verifiedAt` and `verificationMethod`. A phone number in a message is never proof of tenancy. Linking a tenant requires either a verified `User.phoneE164` that matches a `TenantOrganisation` that the landlord created, or redemption of a `TenantAccessInvitation` code.
- **Landlord onboarding drafts** (new `OnboardingDraft`): JSON draft keyed by identity, resumable, committed through the existing `createOrganisation` / property / unit / tenant services in one transaction on confirm. Ownership claims create a `PortfolioVerification` record in `PENDING`; nothing is marked verified by conversation alone.
- **Provider network consent**: extend `ProviderOrganisation` with `invitationStatus` (`INVITED`, `ACCEPTED`, `DECLINED`, `REVOKED`), `autoDispatchAllowed`, `spendingLimitMinor`, `allowedCategories`, `propertyScope`. Providers created by a landlord and not yet linked to a user are `INVITED`; the provider confirms on WhatsApp (opt-in recorded) before any work order is sent. Marketplace providers always start as `INVITED`.
- **`MaintenanceRoutingRule`** (new): org scope plus optional property/unit, category, keywords, primary provider link, ordered backups, `autoDispatch`, `authorizationMode` (`PRE_AUTHORIZED`, `INSPECTION_ONLY`, `QUOTE_REQUIRED`, `CAP`, `APPROVAL_REQUIRED`, `ESCALATE`), `spendingCapMinor`, `responseTimeoutMinutes`, `maxAttempts`, `escalationMemberId`, `notifyTenant`, `requireCompletionVerification`, `pausedAt`. The most specific matching rule wins; ties fail closed to escalation.
- **AI boundary**: the model only returns a structured classification (category, urgency, safety flags, summary, unit hints). Deterministic code picks the rule and provider and checks the cap. Provider IDs and limits never come from model output.
- **One acceptance model**: dispatch acceptance creates the `ProviderAssignment`; `MaintenanceDispatchAttempt` remains the attempt log with an idempotency key `(maintenanceRequestId, attemptNumber)`.
- **Ticket reference**: `OrganisationCounter(organisationId, key)` incremented in the same transaction; `MaintenanceRequest.referenceNumber` unique per org, formatted `NM-<n>`.
- **Notifications**: new `StaffNotification` (recipient member or provider, `severity` `ROUTINE` / `ATTENTION` / `CRITICAL`, dedupe key, delivery status). `ROUTINE` goes to the digest only; `ATTENTION` and `CRITICAL` are sent immediately, and `CRITICAL` is never suppressed. Per-member `NotificationPreference` can opt categories into immediate delivery.
- **Digest**: `DigestRun(organisationId, memberId, date)` unique, so a retry never sends a second digest. The digest is built from DB queries, uses a template outside the 24h window, and records the outcome.
- **Paid work idempotency**: a dispatch is sent only after the attempt row is committed; the outbound send job is keyed on the attempt id, and a failed send never creates a new attempt.

## 4. Phases

Each phase ships with migrations, services, WhatsApp flows, and Postgres integration tests (the existing `tests/postgres-*.integration.test.ts` pattern).

0. **Stabilise WhatsApp foundation.** Fix the defects in section 2.8. Add tests for the webhook route, payload parsing, dedup and delivery status. Add a `DEAD_LETTER` job state.
1. **Identity and platform channel.** Add `ChannelIdentity`, the platform WhatsApp channel, WhatsApp-to-user OTP linking (OTP over SMS until a WhatsApp authentication template is approved), and an intent router (landlord / tenant / provider / marketplace).
2. **Landlord onboarding.** Resumable draft flow covering steps 1-17 of the brief (multiple buildings and units, CSV bulk upload via signed upload link, tenants, rent terms, reminder policies), commit through the existing services, and pending ownership verification.
3. **Private provider network.** Consent fields, invite and acceptance over WhatsApp, landlord change/suspend/remove/reassign, scope enforcement, and a provider job view limited to assigned jobs.
4. **Tenant linking and ticket intake.** Tenancy resolution with clarification on ambiguity, media download into `StorageObject`, `NM-` references, duplicate-incident check, and the AI classifier.
5. **Routing rules and controlled dispatch.** Rule engine, `MaintenanceRoutingRule` CRUD (web plus WhatsApp with a confirmation step), work order send, timeout sweeper job, backup provider, and escalation.
6. **Provider actions.** Accept, decline, request info, propose appointment, quote (cap check leads to an approval state), status updates, completion with evidence, tenant feedback and reopen.
7. **Notification levels and digest.** `StaffNotification`, preferences, critical alerts, daily digest and drill-down commands, plus natural-language landlord queries through read-only tools.
8. **Hardening.** Security tests for the 17 brief scenarios, admin investigation view of the ticket timeline, manual override, deployment docs (Meta app, templates to submit, env vars), and monitoring.

Real WhatsApp delivery will not be claimed working until the Meta app, the number, the templates and an end-to-end test on a real device are done.

## 5. Progress

### Phase 0: WhatsApp foundation (done)

- Webhook parsing checks each message and status on its own. Unknown items are skipped and logged; the batch is still acknowledged with 200 so Meta does not retry it or disable the webhook.
- Send outcomes are classified. 429/5xx are retried. Missing configuration, a closed 24h window and other 4xx are permanent. A timeout or a missing receipt is `UNCONFIRMED` (new `MessageDeliveryStatus`) and is never resent automatically; staff can retry it explicitly.
- New `BackgroundJobStatus.DEAD_LETTER`. Jobs move there on `NonRetryableJobError` (`src/platform/jobs/errors.ts`) or when attempts run out. `retryBackgroundJob` requeues one more attempt. Platform health lists dead-lettered jobs.
- The assistant worker decides outside any database transaction (AI and OTP calls) and commits only if the conversation did not change meanwhile.
- Closed or resolved conversations restart the assistant instead of muting the person. While a person is in the support queue, `menu` or `cancel` returns them to the assistant. Threads owned by staff stay quiet.
- WhatsApp reminders use the organisation's own number or the official number, and require the approved template `WHATSAPP_TEMPLATE_NOTIFICATION`. Without one they fail permanently with a clear reason instead of retrying.
- Delivery statuses also update `Notification` rows. Statuses that match nothing are retried for 15 minutes and then dropped.
- STOP / START opt-out is recorded on `ChannelIdentity` and makes WhatsApp notifications `SKIPPED`.

### Phase 1: identity and official number (done)

- `ChannelIdentity` (channel + E.164 address, optional verified `userId`, opt-out). Every inbound WhatsApp message records the address; it never grants access by itself.
- Official number: `/api/webhooks/whatsapp`, backed by the WhatsApp channel config of the organisation in `WHATSAPP_OFFICIAL_ORGANISATION_ID`. Per-organisation numbers keep using `/api/webhooks/whatsapp/[organisationId]`.
- Account linking on the official number (`link`): a code is sent by SMS (Arkesel) to the WhatsApp number, or by email to an address the person gives. The number is linked only after the code is verified through the existing OTP service. The code message is removed from the transcript. Linking and unlinking are audited.
- `account` shows, for a linked number only: portfolios the user can read (`property.read`), their active tenancies, and provider jobs for provider profiles they own. `unlink` removes the link.
- Tests: `tests/whatsapp-payload.unit.test.ts`, `tests/whatsapp-official-router.unit.test.ts`, `tests/postgres-whatsapp-official.integration.test.ts`.

### Before going live (not done)

1. In Meta: create the app and WhatsApp Business Account, register the official number, create a system-user token, and subscribe the webhook to `messages` at `https://<host>/api/webhooks/whatsapp` with the verify token stored on the official organisation's channel config.
2. Submit and get approval for the notification template (one body variable), then set `WHATSAPP_TEMPLATE_NOTIFICATION`.
3. Set `WHATSAPP_PROVIDER_ACCESS_TOKEN`, `WHATSAPP_GRAPH_API_VERSION`, `WHATSAPP_APP_SECRET`, `WHATSAPP_OFFICIAL_ORGANISATION_ID`, and the Arkesel variables for SMS codes.
4. Run an end-to-end test from a real phone. Until then, real WhatsApp delivery is unverified.
