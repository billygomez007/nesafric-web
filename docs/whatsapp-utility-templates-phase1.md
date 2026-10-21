# WhatsApp Utility templates: Phase 1 report

Status on 21 October 2026, branch `claude/vibrant-cray-ei6kmy`.

**Meta status:** all 30 templates are **NOT SUBMITTED**. Nothing was sent to Meta. This environment has no NesAfric Meta credentials, and the brief says no production template submissions without explicit approval. Also, the bodies in the registry are **drafts**, because the U01–U30 catalogue text was not available when this was built (see finding S1). Phase 1 is therefore **not yet accepted**. The infrastructure is built and tested, but the acceptance criteria also need templates that Meta approved and that fire from their events in staging.

Contents:

1. Initial integration audit
2. 30-template registry
3. Meta submission payloads
4. Template approval status report
5. Backend implementation summary
6. Event-to-template mapping
7. End-to-end test results
8. Outstanding Meta dashboard requirements
9. Security and compliance findings
10. Production readiness checklist

---

## 1. Initial integration audit

**What already existed (before this branch)**

| Area | Finding |
|---|---|
| Meta app / WABA / phone number | Not in the repository, which is correct. The official number is a platform assignment (`WhatsAppNumberAssignment`, `official = true`) on the organisation named by `WHATSAPP_OFFICIAL_ORGANISATION_ID`. The phone number ID and WABA ID are recorded on that assignment. No real IDs or tokens are committed, and none were found in the history checked. |
| Credentials | `WHATSAPP_PROVIDER_ACCESS_TOKEN` (one system-user token for all numbers), `WHATSAPP_APP_SECRET` (webhook HMAC), `WHATSAPP_GRAPH_API_VERSION`. All come from the environment. Sends fail closed without them. |
| Webhook | `/api/webhooks/whatsapp` (official) and `/api/webhooks/whatsapp/<orgId>`. The `X-Hub-Signature-256` check is constant-time, bodies are capped at 1 MiB, only the assigned phone number ID and WABA are accepted, the receipt is durable and processing is done by jobs. |
| Tap & Order | **No reference to Tap & Order anywhere in this repository** (code, config, env example, docs). Nothing in NesAfric reads or writes another product's configuration. The risk is outside the code: the system-user token may also reach Tap & Order's WABA. Template management now refuses to act on any WABA except the official NesAfric one, and only when two independent settings agree (finding S3). Someone still has to check this in Meta Business Manager (section 8). |
| Templates | Three env-configured templates: `WHATSAPP_TEMPLATE_NOTIFICATION`, `_PROVIDER_INVITE`, `_WORK_ORDER`. They have no status sync, no registry and no submission tooling. Their real Meta status is unknown from here. Run `sync` (section 4) to list them. They show as "unmanaged" and are never changed. |
| Reusable services | `queueOfficialTemplate` / `queueOfficialText` (idempotent by message key, STOP opt-out, assignment lock), the delivery job (429/5xx retried; timeouts marked unconfirmed and never resent), delivery/read/failed status webhooks, `ChannelIdentity` (OTP-verified number links, STOP/START), and a `DomainEvent` written in the same transaction as each business change, which nothing read until now. |
| WhatsApp journeys | Already built: marketplace search and enquiry/viewing requests in chat, account linking by SMS/email OTP, landlord onboarding (workspace, properties, units, ownership claim), provider network and work orders, tenant repair reports with photos, tenant access-code redemption, landlord rules/questions, STOP/START. See section 9 (S6) for the gaps. |

## 2. Complete 30-template registry

Source of truth: `src/modules/whatsapp-templates/registry.ts`. Every template has: key, Meta name (`_v<n>` added from version 2), language `en`, category `UTILITY`, body, ordered placeholder mapping with realistic samples and length limits, business event and condition, recipient role, allowed opt-in basis, wiring status, content status (`DRAFT` for all 30) and version (1). Meta approval status and the last sync time are kept in `WhatsAppTemplateState`, and `npm run whatsapp:templates -- report` joins them in.

Opt-in bases: `ENQUIRY_OPT_IN` means the enquirer ticked "send updates on WhatsApp" or made the enquiry on WhatsApp. `LINKED_ACCOUNT` means the number was linked to the account with a one-time code. `TENANT_CONSENT_RECORDED` means the landlord recorded the tenant's WhatsApp consent on the tenancy, and applies to the invitation only. STOP overrides every basis.

### Customer property enquiries (U01–U06)

| Key | Meta name | Body | Placeholders (sample) | Event | Recipient / opt-in | Wiring |
|---|---|---|---|---|---|---|
| U01 | `nesafric_enquiry_received` | Hello {{1}}, we have received your enquiry about {{2}}. Your reference is {{3}}. The agent or landlord will reply to you on WhatsApp or by phone. | {{1}} recipient_name ("Ama")<br>{{2}} listing_title ("2-bedroom apartment in East Legon")<br>{{3}} enquiry_reference ("EQ-7K4P2Q") | `marketplace.lead_created` (Enquiry made on the website with WhatsApp updates ticked. Enquiries made on WhatsApp are answered in the chat.) | PROPERTY_SEEKER / ENQUIRY_OPT_IN | WIRED |
| U02 | `nesafric_viewing_confirmed` | Hello {{1}}, your viewing of {{2}} is confirmed for {{3}}. The property is in {{4}}. If you can no longer attend, please reply to this message. | {{1}} recipient_name ("Kwame")<br>{{2}} listing_title ("3-bedroom house in Spintex")<br>{{3}} viewing_time ("Sat, 26 Oct 2026, 10:00 GMT")<br>{{4}} area ("Spintex, Accra") | `viewing.confirmed` (The agent or landlord confirms a time.) | PROPERTY_SEEKER / ENQUIRY_OPT_IN | WIRED |
| U03 | `nesafric_viewing_rescheduled` | Hello {{1}}, your viewing of {{2}} has been moved to {{3}}. If the new time does not suit you, please reply to this message. | {{1}} recipient_name ("Kwame")<br>{{2}} listing_title ("3-bedroom house in Spintex")<br>{{3}} viewing_time ("Wed, 28 Oct 2026, 16:30 GMT") | `viewing.rescheduled` (The agent or landlord moves a viewing.) | PROPERTY_SEEKER / ENQUIRY_OPT_IN | WIRED |
| U04 | `nesafric_viewing_cancelled` | Hello {{1}}, your viewing of {{2}} has been cancelled. Reason: {{3}}. Reply to this message if you would like to arrange another time. | {{1}} recipient_name ("Kwame")<br>{{2}} listing_title ("3-bedroom house in Spintex")<br>{{3}} reason ("the property has been let") | `listing.viewing_status_changed` (Status changes to CANCELLED.) | PROPERTY_SEEKER / ENQUIRY_OPT_IN | WIRED |
| U05 | `nesafric_viewing_request_received` | Hello {{1}}, we have received your request to view {{2}}. Your reference is {{3}}. We will message you here once the time is confirmed. | {{1}} recipient_name ("Esi")<br>{{2}} listing_title ("Studio apartment in Osu")<br>{{3}} viewing_reference ("VW-3M8D1R") | `viewing.requested` (Viewing requested on the website with WhatsApp updates ticked. Requests made on WhatsApp are answered in the chat.) | PROPERTY_SEEKER / ENQUIRY_OPT_IN | WIRED |
| U06 | `nesafric_application_status_update` | Hello {{1}}, the status of your rental application for {{2}} is now {{3}}. You can see the details and any next steps in your NesAfric account. | {{1}} recipient_name ("Yaw")<br>{{2}} listing_title ("2-bedroom apartment in Tema Community 25")<br>{{3}} application_status ("under review") | `rental_application.status_changed` (The landlord moves the application to a new status.) | PROPERTY_SEEKER / LINKED_ACCOUNT | NOT WIRED: Rental applications emit no domain event and applicants record no WhatsApp opt-in yet. |

### Agent and broker onboarding (U07–U11)

| Key | Meta name | Body | Placeholders (sample) | Event | Recipient / opt-in | Wiring |
|---|---|---|---|---|---|---|
| U07 | `nesafric_business_profile_created` | Hello {{1}}, your business profile {{2}} has been created on NesAfric. To get verified, upload your verification documents in your NesAfric dashboard. | {{1}} recipient_name ("Kofi")<br>{{2}} business_name ("Golden Key Realty") | `marketplace_professional.created` (An agent or broker creates a business profile.) | AGENT_OR_BROKER / LINKED_ACCOUNT | WIRED |
| U08 | `nesafric_business_verification_approved` | Hello {{1}}, the verification of {{2}} on NesAfric has been approved. Your profile and listings now show as verified. | {{1}} recipient_name ("Kofi")<br>{{2}} business_name ("Golden Key Realty") | `marketplace_professional.verification_reviewed` (A NesAfric reviewer sets the profile to VERIFIED.) | AGENT_OR_BROKER / LINKED_ACCOUNT | WIRED |
| U09 | `nesafric_business_verification_action_required` | Hello {{1}}, the verification of {{2}} could not be approved. Reason: {{3}}. Please update your documents in your NesAfric dashboard and submit them again. | {{1}} recipient_name ("Kofi")<br>{{2}} business_name ("Golden Key Realty")<br>{{3}} reason ("the business registration certificate is not readable") | `marketplace_professional.verification_reviewed` (A NesAfric reviewer sets the profile to REJECTED.) | AGENT_OR_BROKER / LINKED_ACCOUNT | WIRED |
| U10 | `nesafric_listing_submitted` | Hello {{1}}, your listing {{2}} has been submitted for review. Reference: {{3}}. We will message you here when the review is complete. | {{1}} recipient_name ("Abena")<br>{{2}} listing_title ("4-bedroom townhouse in Cantonments")<br>{{3}} listing_reference ("LS-9F2C7A") | `listing.pending_review` (A listing moves to PENDING_REVIEW.) | AGENT_OR_BROKER / LINKED_ACCOUNT | WIRED |
| U11 | `nesafric_listing_review_completed` | Hello {{1}}, the review of your listing {{2}} is complete. Outcome: {{3}}. You can see the details in your NesAfric dashboard. | {{1}} recipient_name ("Abena")<br>{{2}} listing_title ("4-bedroom townhouse in Cantonments")<br>{{3}} outcome ("approved and published") | `listing.published | listing.rejected` (A listing leaves PENDING_REVIEW, decided by someone other than its creator.) | AGENT_OR_BROKER / LINKED_ACCOUNT | WIRED |

### Landlord and property manager onboarding (U12–U16)

| Key | Meta name | Body | Placeholders (sample) | Event | Recipient / opt-in | Wiring |
|---|---|---|---|---|---|---|
| U12 | `nesafric_property_ownership_received` | Hello {{1}}, we have received the ownership details for {{2}}. Our team will review them and message you here with the outcome. | {{1}} recipient_name ("Akosua")<br>{{2}} property_name ("Adenta Court") | `portfolio_verification.created` (A landlord registers a property claim.) | LANDLORD_OR_MANAGER / LINKED_ACCOUNT | NOT WIRED: Claims are only created by the landlord's own onboarding, which confirms in the WhatsApp chat or on screen; no event is emitted. |
| U13 | `nesafric_workspace_activated` | Hello {{1}}, your NesAfric workspace {{2}} is now active. You can add properties, units and tenants in your dashboard, or reply menu here. | {{1}} recipient_name ("Akosua")<br>{{2}} workspace_name ("Mensah Properties") | `organisation.created` (A landlord or property-management workspace is created. Not sent while the owner is already chatting with NesAfric (WhatsApp onboarding confirms in the chat).) | LANDLORD_OR_MANAGER / LINKED_ACCOUNT | WIRED |
| U14 | `nesafric_property_ownership_verified` | Hello {{1}}, your ownership details for {{2}} have been verified. You can now manage this property fully on NesAfric. | {{1}} recipient_name ("Akosua")<br>{{2}} property_name ("Adenta Court") | `portfolio_verification.verified` (A NesAfric reviewer verifies the claim.) | LANDLORD_OR_MANAGER / LINKED_ACCOUNT | WIRED |
| U15 | `nesafric_property_ownership_action_required` | Hello {{1}}, we could not verify the ownership details for {{2}}. Reason: {{3}}. Please contact NesAfric support to provide more information. | {{1}} recipient_name ("Akosua")<br>{{2}} property_name ("Adenta Court")<br>{{3}} reason ("the name on the document does not match the account") | `portfolio_verification.rejected` (A NesAfric reviewer rejects the claim.) | LANDLORD_OR_MANAGER / LINKED_ACCOUNT | WIRED |
| U16 | `nesafric_team_invitation` | Hello {{1}}, {{2}} has invited you to join the {{3}} workspace on NesAfric. Open the invitation sent to your email address to accept it. | {{1}} recipient_name ("Efua")<br>{{2}} inviter_name ("Akosua Mensah")<br>{{3}} workspace_name ("Mensah Properties") | `member.invited` (A workspace owner invites a team member.) | WORKSPACE_MEMBER / LINKED_ACCOUNT | NOT WIRED: Invitations are addressed by email only; there is no phone number or opt-in for the invitee. |

### Tenant management (U17–U22)

| Key | Meta name | Body | Placeholders (sample) | Event | Recipient / opt-in | Wiring |
|---|---|---|---|---|---|---|
| U17 | `nesafric_tenant_invitation` | Hello {{1}}, {{2}} has invited you to connect your tenancy at {{3}} on NesAfric. Your access code was sent to you separately. To continue, tap Link account, confirm your identity and then send your access code here.<br>Button: Link account | {{1}} recipient_name ("Kojo")<br>{{2}} landlord_name ("Mensah Properties")<br>{{3}} property_name ("Adenta Court, Unit 4B") | `tenant.access_invitation_created` (Landlord creates a tenant access invitation for a tenancy that records WhatsApp consent and is not yet connected to an account.) | TENANT / TENANT_CONSENT_RECORDED | WIRED |
| U18 | `nesafric_tenancy_connected` | Hello {{1}}, your NesAfric account is now connected to your tenancy with {{2}}. You can report repairs and view your tenancy details by replying menu here. | {{1}} recipient_name ("Kojo")<br>{{2}} landlord_name ("Mensah Properties") | `tenant.access_invitation_redeemed` (The tenant redeems the access code. Not sent while the tenant is already chatting with NesAfric.) | TENANT / LINKED_ACCOUNT | WIRED |
| U19 | `nesafric_lease_ready_to_sign` | Hello {{1}}, your lease for {{2}} is ready for your signature. Please review and sign it in your NesAfric tenant account. | {{1}} recipient_name ("Kojo")<br>{{2}} property_name ("Adenta Court, Unit 4B") | `signature.request_created` (A signature request is created for the tenant.) | TENANT / LINKED_ACCOUNT | NOT WIRED: Signature requests already notify by email with a signing link; the WhatsApp recipient mapping for lease parties is not built yet. |
| U20 | `nesafric_lease_fully_signed` | Hello {{1}}, all parties have signed the lease for {{2}}. A copy is available in your NesAfric tenant account. | {{1}} recipient_name ("Kojo")<br>{{2}} property_name ("Adenta Court, Unit 4B") | `lease.fully_signed` (The last signature is recorded.) | TENANT / LINKED_ACCOUNT | NOT WIRED: Lease-party to WhatsApp recipient mapping is not built yet. |
| U21 | `nesafric_payment_recorded` | Hello {{1}}, we have recorded your payment of {{2}} for {{3}}. Your receipt is available in your NesAfric tenant account. | {{1}} recipient_name ("Kojo")<br>{{2}} amount ("GHS 2,500.00")<br>{{3}} property_name ("Adenta Court, Unit 4B") | `receipt.issued` (A receipt is issued for a tenant payment.) | TENANT / LINKED_ACCOUNT | NOT WIRED: Payment receipts already go out through the reminder/notification pipeline; wiring needs a dedupe decision with that pipeline. |
| U22 | `nesafric_tenancy_details_updated` | Hello {{1}}, the details of your tenancy at {{2}} have been updated by {{3}}. You can view the full details in your NesAfric tenant account. | {{1}} recipient_name ("Kojo")<br>{{2}} property_name ("Adenta Court, Unit 4B")<br>{{3}} landlord_name ("Mensah Properties") | `lease.amended` (The landlord amends the lease.) | TENANT / LINKED_ACCOUNT | NOT WIRED: Lease-party to WhatsApp recipient mapping is not built yet. |

### Property operations (U23–U27)

| Key | Meta name | Body | Placeholders (sample) | Event | Recipient / opt-in | Wiring |
|---|---|---|---|---|---|---|
| U23 | `nesafric_repair_request_received` | Hello {{1}}, we have received your repair request {{2}} for {{3}}: {{4}}. We will keep you updated here. | {{1}} recipient_name ("Kojo")<br>{{2}} request_reference ("NM-1042")<br>{{3}} property_name ("Adenta Court, Unit 4B")<br>{{4}} issue ("leaking kitchen tap") | `maintenance.requested` (A repair request for a tenancy is created on the web or mobile app. Reports made on WhatsApp are answered in the chat.) | TENANT / LINKED_ACCOUNT | WIRED |
| U24 | `nesafric_repair_request_update` | Hello {{1}}, there is an update on your repair request {{2}} for {{3}}. Status: {{4}}. We will message you here when there is more progress. | {{1}} recipient_name ("Kojo")<br>{{2}} request_reference ("NM-1042")<br>{{3}} property_name ("Adenta Court, Unit 4B")<br>{{4}} status ("work has started") | `maintenance.started | maintenance.rejected | maintenance.cancelled` (Requests handled by the automatic provider network are skipped: providers' updates already reach the tenant.) | TENANT / LINKED_ACCOUNT | WIRED |
| U25 | `nesafric_repair_request_completed` | Hello {{1}}, your repair request {{2}} for {{3}} has been marked as completed. If the problem is not fixed, please reply to this message. | {{1}} recipient_name ("Kojo")<br>{{2}} request_reference ("NM-1042")<br>{{3}} property_name ("Adenta Court, Unit 4B") | `maintenance.completed` (Requests handled by the automatic provider network are skipped: the provider's completion message already reaches the tenant.) | TENANT / LINKED_ACCOUNT | WIRED |
| U26 | `nesafric_new_repair_request` | New repair request {{1}} at {{2}}: {{3}}. Priority: {{4}}. Reply menu to view and manage it here. | {{1}} request_reference ("NM-1042")<br>{{2}} property_name ("Adenta Court, Unit 4B")<br>{{3}} issue ("leaking kitchen tap")<br>{{4}} priority ("normal") | `maintenance.requested` (Landlord or manager on the property's workspace.) | LANDLORD_OR_MANAGER / LINKED_ACCOUNT | NOT WIRED: Landlords already receive escalations and the daily digest for new requests (staff notifications); wiring this would duplicate them. |
| U27 | `nesafric_listing_status_changed` | Hello {{1}}, the status of your listing {{2}} has changed to {{3}}. You can update the listing in your NesAfric dashboard. | {{1}} recipient_name ("Abena")<br>{{2}} listing_title ("4-bedroom townhouse in Cantonments")<br>{{3}} listing_status ("paused") | `listing.status_changed` (Changed by someone other than the listing's creator (for example a suspension).) | AGENT_OR_BROKER / LINKED_ACCOUNT | NOT WIRED: Review outcomes are covered by U11; other changes are made by the creator themselves and would be noise. |

### Account and document activity (U28–U30)

| Key | Meta name | Body | Placeholders (sample) | Event | Recipient / opt-in | Wiring |
|---|---|---|---|---|---|---|
| U28 | `nesafric_document_received` | Hello {{1}}, we have received your document {{2}} for {{3}}. We will message you here when the review is complete. | {{1}} recipient_name ("Abena")<br>{{2}} document_name ("title deed")<br>{{3}} subject ("4-bedroom townhouse in Cantonments") | `listing.verification_submitted` (Verification evidence is submitted.) | AGENT_OR_BROKER / LINKED_ACCOUNT | NOT WIRED: Submission is the recipient's own action and is confirmed on screen; enable once documents can be submitted on WhatsApp. |
| U29 | `nesafric_document_review_completed` | Hello {{1}}, the review of the documents for {{2}} is complete. Result: {{3}}. You can see the details in your NesAfric dashboard. | {{1}} recipient_name ("Abena")<br>{{2}} subject ("4-bedroom townhouse in Cantonments")<br>{{3}} result ("verified") | `listing.verification_verified | listing.verification_rejected` (A reviewer decides the listing's verification evidence.) | AGENT_OR_BROKER / LINKED_ACCOUNT | WIRED |
| U30 | `nesafric_workspace_access_changed` | Hello {{1}}, your access to the {{2}} workspace on NesAfric has changed. Your role is now {{3}}. If you did not expect this, contact your workspace administrator. | {{1}} recipient_name ("Efua")<br>{{2}} workspace_name ("Mensah Properties")<br>{{3}} role ("property manager") | `member.role_changed` (A workspace administrator changes a member's role.) | WORKSPACE_MEMBER / LINKED_ACCOUNT | NOT WIRED: Role changes emit no domain event yet. |

## 3. Meta submission payloads

`docs/whatsapp-utility-template-payloads.json`, generated with `npm run whatsapp:templates -- payloads <file>`. Each payload is what `POST /<WABA_ID>/message_templates` receives. It has `name`, `language: "en"`, `category: "UTILITY"`, `allow_category_change: false` (Meta must reject the template rather than quietly move it to Marketing), a `BODY` with `example.body_text`, and `BUTTONS` where the template has them (U17 only). Regenerate the file after the catalogue text replaces the drafts.

## 4. Template approval status report

| Status | Count | Templates |
|---|---|---|
| APPROVED | 0 | none |
| PENDING | 0 | none |
| REJECTED | 0 | none |
| NOT SUBMITTED | 30 | U01–U30 |

Why none were submitted: the bodies are drafts (S1), no NesAfric Meta credentials are available here, and the brief withholds production submission until it is explicitly approved. Live status: `npm run whatsapp:templates -- sync`, then `report`.

All 30 pass the format checks (placeholders numbered in order, none at the start or end or next to each other, words-to-placeholders ratio, length with the longest values, realistic samples). Flagged for a person to review before submission:

- **All 30:** draft text, which must be replaced with the catalogue text.
- **U17 (tenant invitation):** the recipient's number comes from the landlord. It is sent only when the landlord recorded the tenant's consent, and the access code is never included. Meta may still question consent. Keep this wording strictly transactional.
- **U13, U18, U07, U10:** confirm actions the recipient took themselves. They are Utility (account updates), but Meta sometimes recategorises "welcome" style messages, so keep them free of marketing wording.

## 5. Backend implementation summary

New module `src/modules/whatsapp-templates/`:

| File | Responsibility |
|---|---|
| `registry.ts` | The 30 definitions and the version-to-name rule. |
| `format.ts` | Meta format and compliance validation, creation payloads, content hash (comparable with what Meta returns), parameter ordering and sanitising, transcript rendering. |
| `meta-client.ts` | Business Management API: list (with paging, components included) and create. Calls only `https://graph.facebook.com`, uses no redirects, has timeouts, and never puts the token in errors. |
| `state.ts` | Official-WABA resolution, the two-key WABA check, status sync, guarded submission, template webhooks, the approval gate used before every send, and the status report. Every status change and submission is written to the official organisation's audit log and as a structured log line. |
| `send.ts` | `queueUtilityTemplate`: opt-in basis check, then approval (APPROVED + UTILITY + identical content), then the existing official-number queue (STOP check, idempotent message key, assignment lock, retrying delivery job). |
| `dispatch.ts` | Business events to templates (section 6). Reads `DomainEvent` rows written in each business transaction. Decides each event exactly once under an advisory lock, and records every decision, sent or skipped with a reason, in `WhatsAppUtilityDispatch`. |

Other changes:

- Migration `20261021120000_whatsapp_utility_templates` (additive only): `WhatsAppTemplateState`, `WhatsAppUtilityDispatch`, `MarketplaceLead.whatsappUpdatesConsent`, and an index on `DomainEvent(name, occurredAt)`.
- Webhook parser and receipt: accept `message_template_status_update`, `template_category_update` and `message_template_quality_update` for the official WABA only, as an idempotent `whatsapp-template-status` job.
- `queueOfficialTemplate` also accepts a registry-approved `{ name, language }`. Existing callers are unchanged.
- Two new domain events, written in the existing transactions: `marketplace_professional.verification_reviewed` and `portfolio_verification.verified|rejected`.
- The public enquiry form has a WhatsApp-updates opt-in. It is separate from the marketing consent and only counts when a phone number is given.
- The worker and `/api/jobs/run` run the dispatcher alongside the digest scheduler. It does nothing until `WHATSAPP_UTILITY_EVENTS_SINCE` is set.
- CLI: `npm run whatsapp:templates -- validate | payloads | report | sync | submit`.

What sending guarantees:

- **Never unapproved:** sends need APPROVED, category UTILITY and a content hash equal to the registry's. Pausing, disabling or recategorising a template in a webhook stops its sends immediately.
- **No duplicates:** one ledger row per event, template and recipient, plus a unique message key. The tests replay webhooks and dispatch passes to check this.
- **Retries:** 429 and 5xx are retried with backoff (up to 5 attempts). A timeout after Meta may have accepted the message is marked unconfirmed and never resent.
- **No sends from reads:** only state-change domain events are read. A failure in a notification cannot roll back the business change.
- **No sends for old activity:** events before `WHATSAPP_UTILITY_EVENTS_SINCE`, or older than 48 hours, are never sent.
- **No resubmission loops:** a rejected template is never resubmitted. A template already on Meta is never overwritten. A fix needs new text and a version bump, which gives it a new name.

## 6. Event-to-template mapping

| Event (domain event) | Template | Recipient | Skipped when |
|---|---|---|---|
| Enquiry created (`marketplace.lead_created`) | U01 | Enquirer | Made on WhatsApp (answered in the chat), or no WhatsApp opt-in |
| Viewing requested (`viewing.requested`) | U05 | Enquirer | Made on WhatsApp, or no opt-in |
| Viewing confirmed (`viewing.confirmed`) | U02 | Enquirer | Status has changed since, or listing has no area |
| Viewing rescheduled (`viewing.rescheduled`) | U03 | Enquirer | Status has changed since |
| Viewing cancelled (`listing.viewing_status_changed` → CANCELLED) | U04 | Enquirer | Status has changed since |
| Business profile created (`marketplace_professional.created`) | U07 | Creator (linked) | Recipient is chatting with NesAfric now |
| Agent verification approved / rejected (`marketplace_professional.verification_reviewed`) | U08 / U09 | Owners and admins (linked) | Not linked, or STOP |
| Listing submitted (`listing.pending_review`) | U10 | Creator | Chatting now, or no longer pending |
| Listing review completed (`listing.published` / `listing.rejected` from PENDING_REVIEW) | U11 | Creator | Decided by the creator themselves |
| Workspace activated (`organisation.created`) | U13 | Owner | Marketplace backing organisation, official organisation, or owner chatting now (WhatsApp onboarding confirms in the chat) |
| Ownership verified / rejected (`portfolio_verification.*`) | U14 / U15 | Claimant | Decision has changed since |
| Tenant invitation created (`tenant.access_invitation_created`) | U17 | Tenant's number on the tenancy | No recorded WhatsApp consent, already connected, invitation revoked, redeemed or expired, no property |
| Tenancy connected (`tenant.access_invitation_redeemed`) | U18 | Tenant (linked) | Chatting now |
| Repair request created (`maintenance.requested`) | U23 | Tenant (linked) | Reported on WhatsApp, not tied to a tenancy, or event from another workspace |
| Repair started / rejected / cancelled (`maintenance.*`) | U24 | Tenant | Handled by the provider network (it already messages the tenant) |
| Repair completed (`maintenance.completed`) | U25 | Tenant | Handled by the provider network |
| Listing evidence verified / rejected (`listing.verification_*`) | U29 | Listing creator | Not linked |

Not wired, with the reasons recorded in the registry: U06, U12, U16, U19, U20, U21, U22, U26, U27, U28 and U30. They can be submitted, but nothing triggers them yet.

## 7. End-to-end test results

Run locally against PostgreSQL 16 with the CI bootstrap, the real webhook route, the real job runner and the real services. Only Meta's HTTP calls are replaced by a recorder.

- `tests/whatsapp-utility-templates.unit.test.ts`: 18 test cases (52 runs with the per-template cases, together with the existing payload tests). Covers all 30 definitions (keys, categories, format, samples, rendering), validator rejections and flags, parameter order and sanitising, creation payloads, content hash, the Meta client (paging, host lock, errors without the token), and the template webhook parser (WABA scoping, malformed items).
- `tests/postgres-whatsapp-utility-templates.integration.test.ts`: 10 tests.
  - Sync, and refusal on a WABA mismatch.
  - Submission guards: switched off, wrong WABA, drafts, review flags, rejected never resubmitted, approved never overwritten.
  - Signed template webhooks, deduplicated. Pausing or recategorising a template stops its sends, and other WABAs are ignored.
  - Enquiry: opt-in only, unapproved never sent, no late send after approval, no duplicates, delivered/read receipts.
  - Viewing confirmed, rescheduled and cancelled.
  - Tenant invitation: refused without consent, revoked invitation skipped, code never in the message, then OTP-linked redemption leads to U18.
  - Repairs: web acknowledged, WhatsApp not duplicated, STOP respected, cross-workspace event refused.
  - Agent profile and verification. The backing organisation is not announced.
  - Enable switch and the 48-hour cut-off.
  - Retry on 503, and an unconfirmed send never resent.
- Full suite on the final code (fresh CI-style database): 176 files, 1303 tests, all passing.
- Typecheck and lint on the changed files: clean.

**Not done:** staging tests with authorised test numbers against real Meta. They need the NesAfric staging WABA credentials, and templates approved after the catalogue text is in. See checklist items 4–9.

## 8. Outstanding Meta dashboard requirements

1. In Business Manager, confirm the NesAfric app, WABA and phone number are separate from Tap & Order's. Record the NesAfric WABA ID and phone number ID. If possible, use a **separate system user** for NesAfric whose token can reach **only** the NesAfric WABA.
2. Give the system user `whatsapp_business_management` (templates) as well as `whatsapp_business_messaging`.
3. On the app's webhook subscribe to `messages` (already needed), plus `message_template_status_update`, `template_category_update` and `message_template_quality_update`.
4. Business verification complete, display name approved, and a messaging limit tier high enough for expected volume.
5. Payment method on the WABA. Utility templates are charged outside the customer service window. Since July 2025 they are free inside an open window.
6. The official assignment must carry the WABA ID (`businessAccountId`). Re-assign the number through the platform endpoint if it was assigned without one.
7. Staging: a test WABA or number, plus the authorised test recipient numbers added in WhatsApp Manager.

## 9. Security and compliance findings

| # | Severity | Finding | Status |
|---|---|---|---|
| S1 | Blocker | The U01–U30 catalogue text was not available. The registry holds drafts written against the brief, and submission refuses drafts. | Open: paste the catalogue text into `registry.ts`, keep placeholders matching `params`, and set `content: "FINAL"` |
| S2 | High | Web enquiries had no WhatsApp opt-in. A phone number on a form is not WhatsApp consent. | Fixed: explicit opt-in checkbox, stored per enquiry |
| S3 | High | One system-user token for all numbers could reach other WABAs (for example Tap & Order). | Mitigated in code: template sync and submission act only on the official assignment's WABA, and only when `WHATSAPP_TEMPLATE_WABA_ID` matches. Business Manager still needs a scoped token (section 8.1) |
| S4 | High | Tenant association from a landlord-supplied number. | Already safe: association needs an OTP-verified account plus the one-time access code. U17 adds no shortcut, needs recorded consent and never carries the code. Phase 3 (Authentication OTP templates) can move the OTP onto WhatsApp |
| S5 | Medium | Templates could be sent after Meta recategorised or paused them. | Fixed: the send gate checks status, category and content hash. The webhooks update it at once |
| S6 | Medium | WhatsApp-only journeys missing: agent business registration, logo and verification-document upload, listing creation, photo upload, price and availability edits; landlord logo upload, adding tenants, invitations and tenancy edits; tenant tenancy-detail view in chat. Media is accepted only for maintenance photos (MIME allowlist, size limit, malware-scan hook, which is SKIPPED when no scanner is configured). | Open: product work, not done in this phase. Plan it before announcing "fully on WhatsApp" |
| S7 | Medium | No malware scanner is configured by default, so inbound WhatsApp photos are stored as `SKIPPED` scan. | Open: configure a scanner before accepting documents on WhatsApp |
| S8 | Low | Customer-typed values in templates (names, titles, reasons) could carry links or phone numbers. | Fixed: links and phone numbers are stripped, newlines removed, length capped |
| S9 | Info | Inside an open service window templates are still used, not free text. This is compliant and keeps one code path. | By design |

## 10. Production readiness checklist

1. [ ] Paste the catalogue text (S1), mark the templates FINAL, then run `validate` and regenerate the payloads.
2. [ ] Meta dashboard items in section 8 done; the Tap & Order separation checked in Business Manager.
3. [ ] Migration `20261021120000_whatsapp_utility_templates` applied on staging. It builds an index on `DomainEvent`, which blocks writes to that table while it builds, so check the table size first and apply in a quiet period on production.
4. [ ] Staging env: `WHATSAPP_TEMPLATE_WABA_ID` = staging WABA, then run `sync` and check the unmanaged list shows only the expected templates.
5. [ ] With explicit approval, turn on `WHATSAPP_TEMPLATE_SUBMISSION_ENABLED=true` for one run, then `submit --keys … --confirm-waba <id>` (add `--acknowledge U17` after review). Turn it back off.
6. [ ] Wait for Meta, then `sync` and `report`. Record the APPROVED / PENDING / REJECTED counts. Do not resubmit rejected templates automatically: fix the text and bump the version.
7. [ ] Staging: set `WHATSAPP_UTILITY_EVENTS_SINCE` to now and trigger each wired event with authorised test numbers. Check `WhatsAppUtilityDispatch` (QUEUED or skip reason) and `MessageDelivery` (SENT, DELIVERED, READ).
8. [ ] Test STOP / START from a test phone; the next event must be skipped.
9. [ ] Test the tenant invitation on a test phone: consent recorded, link, OTP, access code, then U18.
10. [ ] Monitoring: alert on `whatsapp.utility_dispatch_failed`, `whatsapp_template.status_changed` to PAUSED, DISABLED or REJECTED, and `category_changed`.
11. [ ] Production: repeat 4–6 on the production WABA, then set `WHATSAPP_UTILITY_EVENTS_SINCE` at go-live. No other routing changes are needed: the official number and webhook stay as they are.

Phase 2 (Marketing templates) has not started and waits for authorisation.
