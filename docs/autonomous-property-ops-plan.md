# Autonomous property operations: architecture map and phased plan

Status (2026-10-18): phases 0-8 are implemented on `feat/autonomous-property-ops`. Real WhatsApp delivery is not verified end to end; see `docs/whatsapp-operations.md` for deployment and the go-live checklist.

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

### Phase 2: landlord onboarding over WhatsApp (done)

- `register` (or menu option 4) on the official number starts a resumable `OnboardingDraft`. Every answer is parsed by deterministic code (`src/modules/whatsapp-assistant/onboarding/parse.ts`) and saved immediately. `pause` or `menu` keeps the draft; `register` or `resume` continues at the saved step, even after the conversation is closed. `discard` abandons it.
- Account: a new person gives their name and confirms the WhatsApp number with an SMS code. That creates the account, or signs into the existing one with that number, and links the number. A number that is already linked skips this step.
- Steps: role (landlord or property manager), organisation (an existing one the person may add properties to, or a new one), then for each property: name, town, address, one building or named blocks, and units per building (a count to auto-number, or `name, type, bedrooms` lines). Then tenants (`unit, name, phone, rent, frequency, start, end` lines), lease-expiry reminders, maintenance professionals (`name, phone, category`), approval limit and urgent-alert contact. Finally a summary and `confirm`.
- Commit (`onboarding/commit.ts`) goes through the existing services: `createOrganisation`, `createProperty`, the new `createBuilding`, `createTenant`, `createLease` and `createReminderPolicy`. Permissions, plan limits, audit and domain events therefore apply as on the web. Each created record is written back to the draft, and each step first looks for its record by a deterministic `WA-xxxxxxxx-…` reference, so a retry resumes without duplicates. If a plan limit blocks saving, the draft is kept and the reason is shown.
- Leases are saved as DRAFT; the existing lease-execution rules still decide activation.
- Each property gets a `PortfolioVerification` claim (OWNER or MANAGER) in PENDING. Nothing marks it verified; review tooling is part of phase 8.
- Not active yet, and the confirmation says so: maintenance professionals, approval limit and alert contact are stored in the draft for phases 3 and 5. Nobody is contacted. Rent-due reminders are not configured, because only lease-expiry reminder policies exist today.
- Tests: `tests/whatsapp-onboarding-parse.unit.test.ts`, `tests/postgres-whatsapp-onboarding.integration.test.ts` (several buildings and properties, resume after a closed conversation, plan limit, redelivered confirmation and retried commit, existing organisation, discard).

### Phase 3: private provider network (done)

- `ProviderNetworkInvitation`: a landlord's request for a professional to join their network, with the proposed work categories, properties (or all), automatic-dispatch flag, spending limit, emergency call-outs, hours and payment terms. No provider profile or directory entry exists until the invited number accepts. Inviting the same number again updates the pending invitation.
- The invitation goes out on the official number with the approved `WHATSAPP_TEMPLATE_PROVIDER_INVITE` template, in the same conversation the reply will arrive in. Without the template nothing is sent and the reason is shown to the landlord.
- The provider replies `accept` or `decline` (typed or tapped). Only the invited number can answer. Accepting creates or reuses their account and an individual provider profile, links the number, and creates the `ProviderOrganisation` entry with `consentedAt`, the scope (`scopeCategories`, `ProviderPropertyScope`) and the settings. A marketplace provider can be invited only on the number on their profile.
- Landlord commands (linked number with `provider.read` / `provider.manage`): `providers`, `add provider` (details, properties, automatic jobs, spending limit, summary, confirm), and `suspend` / `resume` / `remove` / `auto on` / `auto off provider N`, `reassign provider N to M`. Every change needs `confirm` and is audited with before/after values. The same operations are service functions in `src/modules/provider-network/service.ts` for the web.
- `eligibleNetworkProviders(organisationId, { category, propertyId })` is the candidate list phase 5 will use: active, consented, automatic dispatch allowed, in scope, not suspended or removed by the platform. Entries added on the web before invitations existed have no consent and are never returned. The existing voice dispatch path is unchanged.
- Provider job view (`jobs`): only assignments for providers the user owns, with work order, property and unit. No tenant, lease or cost data. Joining a network gives no access to the landlord's records.
- Onboarding now invites the professionals listed during onboarding when the draft is committed.
- Tests: `tests/postgres-provider-network.integration.test.ts`.

### Phase 4: tenant identity and ticket intake (done)

- A tenant can report only when their WhatsApp number is linked to an account (`link`, phase 1) and that account has a tenancy the landlord connected (`TenantOrganisation.userId`) with an ACTIVE or EXPIRING lease. A phone number on the landlord's tenant record is never treated as proof, and nothing about a tenancy is shown before both checks pass.
- Tenants connect a tenancy by sending the landlord's existing access code (`NT-…`) on WhatsApp. It is redeemed through `redeemTenantAccessCode` and removed from the transcript.
- `report`, a free-text description of a problem, or a photo starts a report. The flow picks the home (asks when there are several), takes the description and up to 5 photos, classifies it, checks for an open ticket on the same unit and category from the last 30 days (`same` adds details to it, `new` creates another), and asks for `confirm`.
- Classification (`maintenance/classify.ts`): the AI provider only labels category, urgency, safety hazard and a title, through a schema-checked tool call. Keyword rules run first and set a floor: the model can never lower the urgency or clear a safety hazard they found. Without a model the rules are used alone. Emergencies get safety advice in the reply.
- Tickets are created with the existing `createMaintenanceRequest` (tenant authorisation, audit, domain event). New fields: `referenceNumber` (`NM-1001`, …, per organisation, from `OrganisationCounter`; existing requests were numbered by the migration), `intakeChannel`, `originalReport` and `classification`. Web-created requests get references too. A retried confirmation finds the ticket it already created.
- Photos are downloaded from Meta in the worker (images and PDFs within the upload limit only) and stored as private `MAINTENANCE_ATTACHMENT` uploads through the existing document pipeline.
- `status NM-1001` and `my requests` show the tenant their own tickets.
- Not done yet, for phase 5 onwards: dispatch to a provider, and notifying the landlord.
- Tests: `tests/whatsapp-maintenance-classify.unit.test.ts`, `tests/postgres-whatsapp-maintenance.integration.test.ts`.

### Phase 5: routing rules and controlled dispatch (done)

- `MaintenanceRoutingRule`: scope (organisation, property or unit), network category, optional keywords and priorities, primary and ordered backup providers, `autoDispatch`, authorisation mode (`PRE_AUTHORIZED` with a required cap, `INSPECTION_ONLY`, `QUOTE_REQUIRED`, `APPROVAL_REQUIRED`, `ESCALATE`), response timeout, attempt limit, escalation member, tenant-notification and completion-verification flags, and pause. Service in `src/modules/maintenance-routing/rules.ts`; every change is audited with before/after values.
- Selection (`evaluate.ts`) is deterministic: the most specific applicable rule wins; equally specific rules fail closed; a paused rule blocks dispatch rather than falling through to a broader rule. The AI classification only supplied the ticket's category and urgency.
- Every ticket created over WhatsApp (or in an organisation that has rules) queues a `maintenance-route` job. Each evaluation is stored as a `MaintenanceRoutingDecision`. Anything not dispatched automatically (no rule, ambiguous rules, paused, approval required, escalate, rule owner no longer authorised, no eligible provider, work order not sendable) creates a `MaintenanceEscalation`. Emergencies and safety hazards always create a CRITICAL escalation as well.
- Dispatch runs as the person who created the rule, and their `maintenance.assign` permission is checked each time. It triages the request, creates a work order with the authorisation mode and the authorised spend (the lower of the rule cap and the provider's own limit), a PENDING provider assignment, the attempt (unique per work order and attempt number), the `WORK_ORDER` template message (property, unit, issue, urgency, what is authorised, reply deadline; no tenant details), and a timeout job at the deadline.
- One provider at a time. After a decline (`recordDispatchDecline`, wired to WhatsApp replies in phase 6) or a timeout, the next untried eligible provider in the rule's order is sent the job until the attempt limit, then the landlord is alerted. An unconfirmed or failed send is never resent, and a retried job never creates a second work order or attempt.
- WhatsApp commands for landlords: `rules`, `add rule` (category, property, primary, backups, what they may do, cap, timeout, summary, confirm), `pause rule N`, `resume rule N`, `pause plumbing dispatch` (by work type), `set limit rule N 500`. Every change is read back and needs `confirm`.
- Tests: `tests/maintenance-routing-evaluate.unit.test.ts`, `tests/postgres-maintenance-routing.integration.test.ts`.

### Phase 6: provider acceptance, quotes and completion (done)

- Providers answer on WhatsApp. Tapping Accept/Decline on the work-order template is matched to the exact job through the message it replies to; typed commands take the ticket reference (`accept NM-1001`, `decline NM-1001 reason`). With one open job the reference can be left out. A provider can act only on assignments of provider profiles they own; a late answer after the job moved on is refused.
- Commands: `info NM-1001 question` (an escalation the landlord sees), `visit NM-1001 2026-12-20 14:00` (tenant told), `quote NM-1001 450 what it covers`, `start NM-1001`, `photos NM-1001` (one-hour signed links, accepted jobs only), `done NM-1001`.
- Quotes (`provider-actions.ts`): a quote within the work order's pre-authorised amount is accepted under the rule. Anything above it, or any quote under inspection-only or quote-first rules, creates a pending `MaintenanceApproval` and a `QUOTE_OVER_LIMIT` escalation, and the provider is told not to start paid work. Landlords with `maintenance.approve` reply `approve NM-1001` or `reject NM-1001`, confirm, and the authorised spend becomes exactly the approved amount. Providers cannot approve.
- Completion: `done` asks for the work performed, total cost, photos (stored as private attachments through the document pipeline; the upload target now also admits the provider of an accepted assignment on that request) and anything left to fix, then a confirm. The work order is COMPLETED with the actual cost. The ticket is CLOSED, or COMPLETED awaiting verification when the rule requires it (`verify NM-1001` by the landlord closes it). Cost above what was authorised (`COST_OVER_AUTHORISED`) and remaining work (`FURTHER_WORK_REQUESTED`) are escalated.
- The tenant is told when the job is accepted, a visit is planned and the work is recorded (free text inside the 24-hour window, otherwise the NOTIFICATION template), and can reply `ok NM-1001` or `problem NM-1001`. A problem reopens the ticket and raises `TENANT_DISPUTE`.
- Tests: `tests/postgres-provider-jobs.integration.test.ts`.

### Phase 7: notification levels and daily digest (done)

- Every `MaintenanceEscalation` queues an `escalation-alert` job. Recipients are the escalation's member, or everyone in the organisation who can approve maintenance. CRITICAL is sent at once to all of them, whatever their settings. ATTENTION is sent at once unless the member chose `alerts in digest`. Routine events (dispatches, acceptances, completions) only appear in the digest. Each recipient gets a `StaffNotification` row (QUEUED, SKIPPED with the reason, or FAILED with the reason), and an undeliverable CRITICAL alert is logged as `maintenance.critical_alert_undelivered` for monitoring.
- Messages use free text inside the 24-hour window, otherwise the approved NOTIFICATION template (`queueOfficialText`).
- `NotificationPreference` per member: digest on/off, digest hour (Ghana time), quiet-day summaries, attention items in the digest, and extra reasons to send immediately. WhatsApp: `digest on|off`, `digest at 18`, `quiet days on|off`, `alerts now|in digest`.
- Daily digest (`buildDigest`): new tickets, automatic dispatches, acceptances, jobs in progress, completions, costs and approved quotes (only for members with payment or maintenance-cost rights), tickets open over 7 days, provider declines and no-answers, open alerts, pending approvals, and leases ending within 30 days. Quiet days are skipped unless asked for. `scheduleDueDigests` runs on every worker poll and `/api/jobs/run`; one digest per member per day (dedupe key), so overlapping runs never send two.
- Landlord questions (`landlord.ts`), answered from records with the same permissions as the web: `show ticket NM-1001`, today's costs, work completed today, open requests by unit, repairs needing approval, upcoming lease expiries, units managed, alerts, and `digest` for today so far. Deterministic phrasing first; an AI provider may only pick one read-only report from a fixed list. Phrases that mean a change (“add another electrician”, “set a quote approval limit”) are routed into the confirmed command flows instead of being executed.
- Tests: `tests/whatsapp-landlord-queries.unit.test.ts`, `tests/postgres-staff-notifications.integration.test.ts`.

### Phase 8: hardening, oversight and operations (done)

- Investigation timeline (`maintenance-routing/oversight.ts`): the report and classification, routing decisions with the rule, each dispatch attempt and provider choice, assignments, quotes and approvals, costs, evidence, escalations with who was told, and WhatsApp delivery outcomes, in order. Available to the landlord's team (`maintenance.read`), and to NesAfric support only under an active support session (audited).
- Manual override without losing history: send a job to a chosen consenting network provider, stop automation for a request, resolve alerts. Earlier attempts are kept and marked superseded, and a superseded attempt never triggers a backup. Available as API routes and WhatsApp commands (`send NM-1001 to 2`, `stop NM-1001`, `resolve NM-1001`), each confirmed and audited.
- Ownership claims: platform reviewers with the new `portfolio.verify` permission list and decide pending `PortfolioVerification` claims.
- Monitoring: platform health reports dead-lettered jobs, unconfirmed WhatsApp sends, undeliverable critical alerts, unsendable work orders, open escalations and pending ownership claims.
- API routes for routing rules and the provider network (web parity with the WhatsApp commands).
- Security review fixes:
  - A landlord's confirmation approves only the exact quote they were shown.
  - STOP blocks every business-initiated message, checked both when queued and when sent.
  - Provider invitations are limited (20 a day, 30-day cooldown after a decline).
  - Customer text in official templates has links and phone numbers stripped.
  - A WhatsApp phone number ID can belong to one organisation only.
  - Unlinking or relinking a number discards that number's unfinished onboarding.
  - Signed photo links are removed from the stored transcript once sent.
  - Changing a rule's spending, providers or automation needs approve and assign rights.
  - Fixed a bug where updating a rule reset its keywords and backups.
- Ops runbook, templates and go-live checklist: `docs/whatsapp-operations.md`.
- Tests: `tests/postgres-maintenance-oversight.integration.test.ts`, `tests/postgres-security-hardening.integration.test.ts`.

## 6. Brief test scenarios

| # | Scenario | Covered by |
|---|---|---|
| 1 | Landlord registers through WhatsApp | `postgres-whatsapp-onboarding` "registers a new landlord…" |
| 2 | Multiple buildings and units | same test (two properties, two blocks) |
| 3 | Private plumber and electrician added | `postgres-provider-network` (plumber accepts, electrician declines); onboarding invites both |
| 4 | Tenant reports a plumbing issue | `postgres-whatsapp-maintenance` "creates a referenced ticket…" |
| 5 | Correct plumber receives the authorised work order | `postgres-maintenance-routing` "sends a tenant's plumbing report…" |
| 6 | Plumber accepts, completes and reports | `postgres-provider-jobs` "runs a job from the Accept button…" |
| 7 | Event appears in the daily digest | `postgres-staff-notifications` "sends one digest per day…" |
| 8 | Job above the spending limit escalated | `postgres-provider-jobs` "pauses a quote above the authorised amount…" |
| 9 | Decline then backup contacted | `postgres-maintenance-routing` "tries the backup after a decline…" |
| 10 | No response escalates | same test (both attempts lapse, NO_PROVIDER_ACCEPTED) |
| 11 | Ambiguous tenant identity not linked | `postgres-whatsapp-maintenance` "never links a tenancy from a matching phone number alone…" |
| 12 | Duplicate webhooks create no duplicate jobs | `postgres-whatsapp-official` "stores a redelivered message once"; routing and maintenance "once" tests |
| 13 | Provider cannot access another landlord's records | `postgres-provider-network` "shows a provider only their own assigned jobs…"; `postgres-provider-jobs` "refuses … other providers' jobs" |
| 14 | Critical issues escalate immediately | `postgres-maintenance-routing` "escalates emergencies…"; `postgres-staff-notifications` "sends critical alerts at once…" |
| 15 | Failed notification causes no duplicate dispatch | `postgres-maintenance-routing` "never sends the job again when … unconfirmed" |
| 16 | Pausing a rule stops new automatic assignments | `postgres-maintenance-routing` "does not dispatch under a paused rule…" |
| 17 | Existing functionality intact | full suite (`npm test`) |

### Before going live (not done)

1. In Meta: create the app and WhatsApp Business Account, register the official number, create a system-user token, and subscribe the webhook to `messages` at `https://<host>/api/webhooks/whatsapp` with the verify token stored on the official organisation's channel config.
2. Submit and get approval for the notification template (one body variable) and the provider invitation template (two body variables, Accept/Decline quick replies), and the work-order template (seven body variables, Accept/Decline quick replies), then set `WHATSAPP_TEMPLATE_NOTIFICATION`, `WHATSAPP_TEMPLATE_PROVIDER_INVITE` and `WHATSAPP_TEMPLATE_WORK_ORDER`.
3. Set `WHATSAPP_PROVIDER_ACCESS_TOKEN`, `WHATSAPP_GRAPH_API_VERSION`, `WHATSAPP_APP_SECRET`, `WHATSAPP_OFFICIAL_ORGANISATION_ID`, and the Arkesel variables for SMS codes.
4. Run an end-to-end test from a real phone. Until then, real WhatsApp delivery is unverified.
