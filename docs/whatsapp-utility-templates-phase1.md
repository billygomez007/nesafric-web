# WhatsApp Utility templates: Phase 1 report

Status on 21 October 2026, branch `claude/vibrant-cray-ei6kmy`.

**Meta status:** all 30 templates are **NOT SUBMITTED**. Nothing was sent to Meta. Submission waits for explicit authorisation, and this environment has no NesAfric Meta credentials.

**Catalogue:** the registry now holds the approved U01–U30 catalogue text exactly (`docs/whatsapp-utility-catalogue.md`; differences from the earlier drafts in `docs/whatsapp-utility-diff-report.md`). **16 are FINAL** and pass every local check. **14 are NEEDS_REVIEW**: the catalogue body ends with a variable (and 8 are also variable-dense), which Meta rejects; `submit` refuses them until the catalogue is changed. Proposed wording that passes is in the difference report. Meta readiness: `docs/whatsapp-utility-meta-readiness.md`.

**Local validation is not Meta approval.** FINAL means NesAfric's checks pass; only Meta decides approval and category.

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

Source of truth: `src/modules/whatsapp-templates/registry.ts`. Every template has: key, Meta name (`_v<n>` added from version 2), language `en`, category `UTILITY`, body, ordered placeholder mapping with realistic samples and length limits, business event and condition, recipient role, allowed opt-in basis, wiring status, content status (`FINAL` or `NEEDS_REVIEW`) and version (1). Meta approval status and the last sync time are kept in `WhatsAppTemplateState`, and `npm run whatsapp:templates -- report` joins them in.

Opt-in bases: `ENQUIRY_OPT_IN` means the enquirer ticked "send updates on WhatsApp" or made the enquiry on WhatsApp. `LINKED_ACCOUNT` means the number was linked to the account with a one-time code. `TENANT_CONSENT_RECORDED` means the landlord recorded the tenant's WhatsApp consent on the tenancy, and applies to the invitation and its reminder only. STOP overrides every basis.

### A. Customer property enquiries

| Key | Meta name | Body | Placeholders (sample) | Event | Recipient / opt-in | Content | Wiring |
|---|---|---|---|---|---|---|---|
| U01 | `nes_property_enquiry_received` | Hello {{1}}, your enquiry about property {{2}} has been received by NesAfric. Reference: {{3}}. We will update you when the agent responds. | {{1}} recipient_name ("Ama")<br>{{2}} property_name ("2-bedroom apartment in East Legon")<br>{{3}} reference ("EQ-7K4P2Q") | `marketplace.lead_created` (Enquiry made on the website with WhatsApp updates ticked. Enquiries made on WhatsApp are answered in the chat.) | PROPERTY_SEEKER / ENQUIRY_OPT_IN | FINAL | WIRED |
| U02 | `nes_property_viewing_confirmed` | Hello {{1}}, your property viewing for {{2}} is confirmed for {{3}} at {{4}}. Your agent is {{5}}. Reply here if you need assistance. | {{1}} recipient_name ("Kwame")<br>{{2}} property_name ("3-bedroom house in Spintex")<br>{{3}} date ("Sat, 26 Oct 2026")<br>{{4}} time ("10:00 GMT")<br>{{5}} agent_name ("Abena Agyei") | `viewing.confirmed` (The agent or landlord confirms a time.) | PROPERTY_SEEKER / ENQUIRY_OPT_IN | FINAL | WIRED |
| U03 | `nes_property_viewing_reminder` | Reminder from NesAfric: Your viewing for {{1}} is scheduled for {{2}} at {{3}}. Your booking reference is {{4}}. | {{1}} property_name ("3-bedroom house in Spintex")<br>{{2}} date ("Sat, 26 Oct 2026")<br>{{3}} time ("10:00 GMT")<br>{{4}} reference ("VW-3M8D1R") | `viewing.reminder_due` (A confirmed viewing is approaching.) | PROPERTY_SEEKER / ENQUIRY_OPT_IN | NEEDS_REVIEW | NOT WIRED: No business event marks an approaching viewing; this needs a scheduled reminder job over confirmed viewings, not a new event. |
| U04 | `nes_property_viewing_rescheduled` | Hello {{1}}, your viewing for {{2}} has been rescheduled to {{3}} at {{4}}. Please reply if you need help. | {{1}} recipient_name ("Kwame")<br>{{2}} property_name ("3-bedroom house in Spintex")<br>{{3}} date ("Wed, 28 Oct 2026")<br>{{4}} time ("16:30 GMT") | `viewing.rescheduled` (The agent or landlord moves a viewing to a new confirmed time.) | PROPERTY_SEEKER / ENQUIRY_OPT_IN | FINAL | WIRED |
| U05 | `nes_property_enquiry_response` | Hello {{1}}, there is an update to your enquiry about {{2}}. Status: {{3}}. Reference: {{4}}. Reply to this message to continue your enquiry. | {{1}} recipient_name ("Ama")<br>{{2}} property_name ("2-bedroom apartment in East Legon")<br>{{3}} status ("the agent has responded")<br>{{4}} reference ("EQ-7K4P2Q") | `listing.lead_status_changed` (The enquiry moves to CONTACTED, CLOSED or LOST. Viewing and application stages have their own messages.) | PROPERTY_SEEKER / ENQUIRY_OPT_IN | FINAL | WIRED |
| U06 | `nes_property_viewing_cancelled` | Hello {{1}}, your viewing for {{2}} scheduled for {{3}} has been cancelled. Reference: {{4}}. Reply here if you need assistance. | {{1}} recipient_name ("Kwame")<br>{{2}} property_name ("3-bedroom house in Spintex")<br>{{3}} scheduled_for ("Sat, 26 Oct 2026, 10:00 GMT")<br>{{4}} reference ("VW-3M8D1R") | `listing.viewing_status_changed` (Status changes to CANCELLED.) | PROPERTY_SEEKER / ENQUIRY_OPT_IN | FINAL | WIRED |

### B. Agent and broker onboarding

| Key | Meta name | Body | Placeholders (sample) | Event | Recipient / opt-in | Content | Wiring |
|---|---|---|---|---|---|---|---|
| U07 | `nes_agent_registration_received` | Hello {{1}}, NesAfric has received your {{2}} registration for {{3}}. Your registration reference is {{4}}. We will notify you when the review is complete. | {{1}} recipient_name ("Kofi")<br>{{2}} registration_type ("agent")<br>{{3}} business_name ("Golden Key Realty")<br>{{4}} reference ("RG-4D7A1C") | `marketplace_professional.created` (An agent or broker creates a business profile. Not sent while they are chatting with NesAfric (WhatsApp registration confirms in the chat).) | AGENT_OR_BROKER / LINKED_ACCOUNT | FINAL | WIRED |
| U08 | `nes_agent_verification_approved` | Hello {{1}}, your NesAfric agent or broker verification for {{2}} has been approved. You can now continue managing your business through WhatsApp. | {{1}} recipient_name ("Kofi")<br>{{2}} business_name ("Golden Key Realty") | `marketplace_professional.verification_reviewed` (A NesAfric reviewer sets the profile to VERIFIED.) | AGENT_OR_BROKER / LINKED_ACCOUNT | FINAL | WIRED |
| U09 | `nes_agent_verification_action_required` | Hello {{1}}, your verification for {{2}} requires additional information: {{3}}. Reply to this message to continue the verification process. | {{1}} recipient_name ("Kofi")<br>{{2}} business_name ("Golden Key Realty")<br>{{3}} required_information ("a readable business registration certificate") | `marketplace_professional.verification_reviewed` (A NesAfric reviewer sets the profile to REJECTED with what is needed; the agent can register again on WhatsApp.) | AGENT_OR_BROKER / LINKED_ACCOUNT | FINAL | WIRED |
| U10 | `nes_property_listing_received` | Hello {{1}}, your property listing {{2}} has been received. Listing reference: {{3}}. Current status: {{4}}. | {{1}} recipient_name ("Abena")<br>{{2}} property_title ("4-bedroom townhouse in Cantonments")<br>{{3}} reference ("LS-9F2C7A")<br>{{4}} status ("pending review") | `listing.pending_review` (A listing moves to PENDING_REVIEW. Not sent while the lister is chatting with NesAfric.) | AGENT_OR_BROKER / LINKED_ACCOUNT | NEEDS_REVIEW | WIRED |
| U11 | `nes_property_listing_status` | Hello {{1}}, the status of your property listing {{2}} has changed to {{3}}. Reference: {{4}}. Reply for assistance. | {{1}} recipient_name ("Abena")<br>{{2}} property_title ("4-bedroom townhouse in Cantonments")<br>{{3}} status ("published")<br>{{4}} reference ("LS-9F2C7A") | `listing.published | listing.rejected` (A listing leaves PENDING_REVIEW, decided by someone other than its creator.) | AGENT_OR_BROKER / LINKED_ACCOUNT | FINAL | WIRED |

### C. Landlord and property manager onboarding

| Key | Meta name | Body | Placeholders (sample) | Event | Recipient / opt-in | Content | Wiring |
|---|---|---|---|---|---|---|---|
| U12 | `nes_manager_registration_received` | Hello {{1}}, we have received the registration for your property management business {{2}}. Reference: {{3}}. Status: {{4}}. | {{1}} recipient_name ("Akosua")<br>{{2}} business_name ("Mensah Properties")<br>{{3}} reference ("PM-2B9E4F")<br>{{4}} status ("active") | `organisation.created` (A property-management business is registered.) | LANDLORD_OR_MANAGER / LINKED_ACCOUNT | NEEDS_REVIEW | NOT WIRED: Registration has no review step: the workspace is active at once and U13 reports that from the same event. Sending both would message the manager twice. |
| U13 | `nes_workspace_activated` | Hello {{1}}, your NesAfric workspace for {{2}} is now active. You can manage your properties and tenants through WhatsApp. | {{1}} recipient_name ("Akosua")<br>{{2}} workspace_name ("Mensah Properties") | `organisation.created` (A landlord or property-management workspace is created. Not sent while the owner is already chatting with NesAfric (WhatsApp onboarding confirms in the chat).) | LANDLORD_OR_MANAGER / LINKED_ACCOUNT | FINAL | WIRED |
| U14 | `nes_business_profile_updated` | Hello {{1}}, the business profile for {{2}} has been updated successfully. Updated information: {{3}}. | {{1}} recipient_name ("Akosua")<br>{{2}} business_name ("Mensah Properties")<br>{{3}} updated_information ("contact phone number and logo") | `marketplace_professional.updated` (An authorised owner or manager updates the business profile.) | LANDLORD_OR_MANAGER / LINKED_ACCOUNT | NEEDS_REVIEW | NOT WIRED: Profile updates write an audit record but no domain event yet, and the person making the change sees it confirmed on screen. |
| U15 | `nes_property_added` | Hello {{1}}, property {{2}} has been added to your NesAfric workspace {{3}}. Property reference: {{4}}. | {{1}} recipient_name ("Akosua")<br>{{2}} property_name ("Adenta Court")<br>{{3}} workspace_name ("Mensah Properties")<br>{{4}} property_reference ("ADC-01") | `property.created` (A property is added to the workspace. Not sent while the person who added it is chatting with NesAfric.) | LANDLORD_OR_MANAGER / LINKED_ACCOUNT | NEEDS_REVIEW | WIRED |
| U16 | `nes_property_registration_action_required` | Hello {{1}}, additional information is needed to complete registration of property {{2}}. Required information: {{3}}. Reply here to continue. | {{1}} recipient_name ("Akosua")<br>{{2}} property_name ("Adenta Court")<br>{{3}} required_information ("a document in the account holder's name") | `portfolio_verification.rejected` (A NesAfric reviewer cannot verify the property claim and records what is needed.) | LANDLORD_OR_MANAGER / LINKED_ACCOUNT | FINAL | WIRED |

### D. Tenant management

| Key | Meta name | Body | Placeholders (sample) | Event | Recipient / opt-in | Content | Wiring |
|---|---|---|---|---|---|---|---|
| U17 | `nes_tenant_invitation` | Hello {{1}}, {{2}} has invited you to join property {{3}} on NesAfric as a tenant. Reply to this message to review and verify your invitation. Reference: {{4}}. | {{1}} recipient_name ("Kojo")<br>{{2}} landlord_name ("Mensah Properties")<br>{{3}} property_name ("Adenta Court, Unit 4B")<br>{{4}} invitation_reference ("TI-8C2F5D") | `tenant.access_invitation_created` (Landlord creates a tenant access invitation for a tenancy that records WhatsApp consent and is not yet connected to an account.) | TENANT / TENANT_CONSENT_RECORDED | NEEDS_REVIEW | WIRED |
| U18 | `nes_tenant_invitation_accepted` | Hello {{1}}, tenant {{2}} has accepted the invitation for property {{3}}. Reference: {{4}}. | {{1}} recipient_name ("Akosua")<br>{{2}} tenant_name ("Kojo Boateng")<br>{{3}} property_name ("Adenta Court, Unit 4B")<br>{{4}} invitation_reference ("TI-8C2F5D") | `tenant.access_invitation_redeemed` (The tenant redeems the access code after OTP verification. Sent to the landlord or manager who created the invitation.) | LANDLORD_OR_MANAGER / LINKED_ACCOUNT | NEEDS_REVIEW | WIRED |
| U19 | `nes_tenant_link_confirmed` | Hello {{1}}, your tenant profile has been linked to property {{2}}, managed by {{3}}. Reply here for assistance. | {{1}} recipient_name ("Kojo")<br>{{2}} property_name ("Adenta Court, Unit 4B")<br>{{3}} manager_name ("Mensah Properties") | `tenant.access_invitation_redeemed` (The tenant redeems the access code after OTP verification. Not sent while the tenant is chatting with NesAfric (the chat confirms it).) | TENANT / LINKED_ACCOUNT | FINAL | WIRED |
| U20 | `nes_tenancy_details_updated` | Hello {{1}}, your tenancy details for {{2}} have been updated by {{3}}. Update reference: {{4}}. Reply if you have questions. | {{1}} recipient_name ("Kojo")<br>{{2}} property_name ("Adenta Court, Unit 4B")<br>{{3}} manager_name ("Mensah Properties")<br>{{4}} reference ("TU-5E1A9B") | `lease.amended` (The landlord records an amendment to a lease that is not a draft (signed lease terms change only by amendment). Sent to each tenant on the lease whose account is connected to the tenancy.) | TENANT / LINKED_ACCOUNT | FINAL | WIRED |
| U21 | `nes_tenant_invitation_reminder` | Hello {{1}}, your invitation from {{2}} to join property {{3}} on NesAfric is still pending. Reply here to continue. Reference: {{4}}. | {{1}} recipient_name ("Kojo")<br>{{2}} landlord_name ("Mensah Properties")<br>{{3}} property_name ("Adenta Court, Unit 4B")<br>{{4}} invitation_reference ("TI-8C2F5D") | `tenant.access_invitation_reminder_due` (An invitation sent with U17 is still pending.) | TENANT / TENANT_CONSENT_RECORDED | NEEDS_REVIEW | NOT WIRED: No event marks a pending invitation; this needs a scheduled reminder with a per-invitation limit, and only after U17 was delivered. |
| U22 | `nes_tenant_link_removed` | Hello {{1}}, your tenant association with property {{2}} has ended effective {{3}}. Contact {{4}} if you believe this is incorrect. | {{1}} recipient_name ("Kojo")<br>{{2}} property_name ("Adenta Court, Unit 4B")<br>{{3}} date ("31 Oct 2026")<br>{{4}} contact ("Mensah Properties") | `lease.terminated | lease.expired` (The lease ends. Effective date: the end date for an expiry, the termination date otherwise. Sent to each tenant on the lease whose account is connected to the tenancy.) | TENANT / LINKED_ACCOUNT | FINAL | WIRED |

### E. Property operations

| Key | Meta name | Body | Placeholders (sample) | Event | Recipient / opt-in | Content | Wiring |
|---|---|---|---|---|---|---|---|
| U23 | `nes_maintenance_request_received` | Hello {{1}}, your maintenance request for property {{2}} has been received. Ticket: {{3}}. Status: {{4}}. | {{1}} recipient_name ("Kojo")<br>{{2}} property_name ("Adenta Court, Unit 4B")<br>{{3}} ticket ("NM-1042")<br>{{4}} status ("received") | `maintenance.requested` (A repair request for a tenancy is created on the web or mobile app. Reports made on WhatsApp are answered in the chat.) | TENANT / LINKED_ACCOUNT | NEEDS_REVIEW | WIRED |
| U24 | `nes_maintenance_request_assigned` | Hello {{1}}, your maintenance request {{2}} has been assigned to {{3}}. Current status: {{4}}. | {{1}} recipient_name ("Kojo")<br>{{2}} ticket ("NM-1042")<br>{{3}} provider_name ("Kwesi Plumbing Services")<br>{{4}} status ("waiting for the provider to accept") | `workorder.assigned` (The landlord assigns a provider to the request's work order. Requests handled by the automatic provider network are skipped: providers' updates already reach the tenant.) | TENANT / LINKED_ACCOUNT | NEEDS_REVIEW | WIRED |
| U25 | `nes_maintenance_status_updated` | Hello {{1}}, maintenance ticket {{2}} for property {{3}} has been updated. New status: {{4}}. | {{1}} recipient_name ("Kojo")<br>{{2}} ticket ("NM-1042")<br>{{3}} property_name ("Adenta Court, Unit 4B")<br>{{4}} status ("work has started") | `maintenance.started | maintenance.rejected | maintenance.cancelled` (Sent to the tenant. Requests handled by the automatic provider network are skipped: providers' updates already reach the tenant. Landlords keep their existing escalations and digest.) | TENANT / LINKED_ACCOUNT | NEEDS_REVIEW | WIRED |
| U26 | `nes_maintenance_request_completed` | Hello {{1}}, maintenance request {{2}} for property {{3}} has been marked completed. Reply here if the issue is unresolved. | {{1}} recipient_name ("Kojo")<br>{{2}} ticket ("NM-1042")<br>{{3}} property_name ("Adenta Court, Unit 4B") | `maintenance.completed` (Requests handled by the automatic provider network are skipped: the provider's completion message already reaches the tenant.) | TENANT / LINKED_ACCOUNT | FINAL | WIRED |
| U27 | `nes_property_management_assignment` | Hello {{1}}, you have been assigned to manage property {{2}} under workspace {{3}}. Assignment reference: {{4}}. | {{1}} recipient_name ("Efua")<br>{{2}} property_name ("Adenta Court")<br>{{3}} workspace_name ("Mensah Properties")<br>{{4}} reference ("PA-6F3C2E") | `property.manager_assigned` (An authorised administrator assigns a manager to a property.) | WORKSPACE_MEMBER / LINKED_ACCOUNT | NEEDS_REVIEW | NOT WIRED: Property-level manager assignments do not exist as records or events; access is granted per workspace role. |

### F. Account and document activity

| Key | Meta name | Body | Placeholders (sample) | Event | Recipient / opt-in | Content | Wiring |
|---|---|---|---|---|---|---|---|
| U28 | `nes_document_received` | Hello {{1}}, your document for {{2}} has been received by NesAfric. Reference: {{3}}. Status: {{4}}. | {{1}} recipient_name ("Abena")<br>{{2}} document_purpose ("verification of 4-bedroom townhouse in Cantonments")<br>{{3}} reference ("DC-1A7B3E")<br>{{4}} status ("under review") | `listing.verification_submitted` (Listing verification evidence is submitted. Not sent while the submitter is chatting with NesAfric.) | AGENT_OR_BROKER / LINKED_ACCOUNT | NEEDS_REVIEW | WIRED |
| U29 | `nes_document_review_completed` | Hello {{1}}, the review of your document for {{2}} is complete. Result: {{3}}. Reference: {{4}}. | {{1}} recipient_name ("Abena")<br>{{2}} document_purpose ("verification of 4-bedroom townhouse in Cantonments")<br>{{3}} result ("verified")<br>{{4}} reference ("DC-1A7B3E") | `listing.verification_verified | listing.verification_rejected` (A reviewer decides the listing's verification evidence.) | AGENT_OR_BROKER / LINKED_ACCOUNT | NEEDS_REVIEW | WIRED |
| U30 | `nes_account_status_updated` | Hello {{1}}, your NesAfric account or business profile {{2}} has a status update: {{3}}. Reference: {{4}}. Reply if you need assistance. | {{1}} recipient_name ("Kofi")<br>{{2}} profile_name ("Golden Key Realty")<br>{{3}} status ("suspended pending review")<br>{{4}} reference ("AS-0C4D8B") | `marketplace_professional.verification_reviewed` (A NesAfric reviewer sets the business profile to SUSPENDED.) | AGENT_OR_BROKER / LINKED_ACCOUNT | FINAL | WIRED |

## 3. Meta submission payloads

`docs/whatsapp-utility-template-payloads.json`, generated with `npm run whatsapp:templates -- payloads <file>`. `eligible` holds the 16 FINAL templates; `needsReview` holds the other 14 with their validation errors (not submittable). Each payload is what `POST /<WABA_ID>/message_templates` receives: `name`, `language: "en"`, `category: "UTILITY"`, `allow_category_change: false` (Meta must reject the template rather than quietly move it to Marketing), and one `BODY` with `example.body_text`. The catalogue has no buttons, header or footer.

## 4. Template approval status report

| Status | Count | Templates |
|---|---|---|
| APPROVED | 0 | none |
| PENDING | 0 | none |
| REJECTED | 0 | none |
| NOT SUBMITTED | 30 | U01–U30 |

Why none were submitted: submission needs explicit authorisation, NesAfric Meta credentials, and (for 14 templates) an approved catalogue change. Live status: `npm run whatsapp:templates -- sync`, then `report`.

Local checks: 16 FINAL pass every check (placeholders numbered in order, none at the start or end or next to each other, words-to-placeholders ratio, length with the longest values, realistic samples, no promotional wording, links or emoji). The 14 NEEDS_REVIEW fail "Body must not end with a placeholder" (and 8 also the words-to-placeholders ratio). See the difference report, section 8.

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

25 templates are wired to real domain events written in the business transaction. Nothing new was invented: every event below already existed.

| Event (domain event) | Template | Recipient | Skipped when |
|---|---|---|---|
| Enquiry created (`marketplace.lead_created`) | U01 | Enquirer | Made on WhatsApp (answered in the chat), or no WhatsApp opt-in |
| Viewing confirmed (`viewing.confirmed`) | U02 | Enquirer | Status changed since, or no agent to name |
| Viewing rescheduled (`viewing.rescheduled`) | U04 | Enquirer | Status changed since, or no new time set yet |
| Enquiry status changed (`listing.lead_status_changed` → CONTACTED, CLOSED, LOST) | U05 | Enquirer | Other stages (viewings and applications have their own flow); a closed enquiry that was reopened |
| Viewing cancelled (`listing.viewing_status_changed` → CANCELLED) | U06 | Enquirer | Status changed since, or no time to name |
| Business profile created (`marketplace_professional.created`) | U07 | Creator (linked) | Creator is chatting with NesAfric now |
| Verification reviewed (`marketplace_professional.verification_reviewed`) | U08 VERIFIED / U09 REJECTED / U30 SUSPENDED | Owners and admins (linked) | Not linked, or STOP |
| Listing submitted (`listing.pending_review`) | U10 | Creator | Chatting now, or no longer pending |
| Listing reviewed (`listing.published` / `listing.rejected` from PENDING_REVIEW) | U11 | Creator | Decided by the creator themselves |
| Workspace created (`organisation.created`) | U13 | Owner | Marketplace backing organisation, official organisation, or owner chatting now |
| Property added (`property.created`) | U15 | Whoever added it (audit record) | Chatting now; another property in the workspace was confirmed in the last 10 minutes; backing or official organisation |
| Ownership claim rejected (`portfolio_verification.rejected`) | U16 | Claimant | Decision changed since |
| Tenant invitation created (`tenant.access_invitation_created`) | U17 | Tenant's number on the tenancy | No recorded WhatsApp consent, already connected, invitation revoked, redeemed or expired, no property |
| Invitation redeemed (`tenant.access_invitation_redeemed`) | U19 tenant / U18 landlord | Tenant (linked) / invitation creator (linked) | Tenant chatting now (U19); landlord not linked (U18) |
| Lease amended (`lease.amended`) | U20 | Each tenant on the lease with a connected account | Draft lease; no connected tenant |
| Lease ended (`lease.terminated`, `lease.expired`) | U22 | Each tenant on the lease with a connected account | Lease no longer ended; no connected tenant |
| Repair request created (`maintenance.requested`) | U23 | Tenant (linked) | Reported on WhatsApp, not tied to a tenancy, or event from another workspace |
| Provider assigned (`workorder.assigned` with a provider assignment) | U24 | Tenant | Staff (not provider) assignment; provider-network routing (it messages the tenant); assignment no longer pending or accepted |
| Repair started / rejected / cancelled (`maintenance.*`) | U25 | Tenant | Handled by the provider network |
| Repair completed (`maintenance.completed`) | U26 | Tenant | Handled by the provider network |
| Listing evidence submitted (`listing.verification_submitted`) | U28 | Listing creator | Chatting now |
| Listing evidence reviewed (`listing.verification_*`) | U29 | Listing creator | Not linked |

Not wired, with reasons in the registry: **U03** (viewing reminder: needs a scheduled job, not an event), **U12** (registration has no review step; U13 already reports the same event), **U14** (profile updates emit no domain event), **U21** (invitation reminder: needs a scheduled job with a one-per-invitation limit), **U27** (property-level manager assignments do not exist).

Landlord maintenance notifications are unchanged: landlords keep the existing escalations and daily digest, and no Utility template goes to the landlord for a repair.

The generic `NOTIFICATION` messages for professional and listing decisions (`src/modules/whatsapp-assistant/notify.ts`) step aside while U08, U09, U30 or U11 is live for that decision, so nobody hears twice.

The first reply to U17 from the invited number gets the verification steps (link the number with a one-time code, then send the access code). It links nothing and never repeats the code; it is found through the dispatch ledger for that exact number only (`src/modules/whatsapp-templates/invitation-reply.ts`).

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
- Full suite on the final code (fresh CI-style database, CI `SESSION_SECRET`): **183 files, 1363 tests, all passing** (baseline 1303; the rest are the merged WhatsApp business-flow tests and the catalogue tests). No regressions.
- Catalogue pass added: exact catalogue fidelity against an independent fixture; FINAL vs NEEDS_REVIEW per template; body-only payloads; enquiry status (U05); viewing names and references (U02, U04, U06); invitation reference, reply guidance shown once and only to the invited number (U17), landlord acceptance (U18) and tenant confirmation (U19); property added once per batch (U15); lease amendments only for connected tenants and never drafts (U20); lease ended (U22); verification action required and suspension (U09, U30); generic decision messages stepping aside for live Utility templates.
- Not covered by an integration test: U24 (provider assignment) and U28 (evidence submitted). Both typecheck and follow the same dispatch path; add tests before staging sign-off.
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
| S1 | Blocker | The U01–U30 catalogue text was not available. | Fixed: catalogue text in the registry exactly. 14 templates are NEEDS_REVIEW because the catalogue body ends with a variable; they need an approved catalogue change (difference report, section 8) |
| S2 | High | Web enquiries had no WhatsApp opt-in. A phone number on a form is not WhatsApp consent. | Fixed: explicit opt-in checkbox, stored per enquiry |
| S3 | High | One system-user token for all numbers could reach other WABAs (for example Tap & Order). | Mitigated in code: template sync and submission act only on the official assignment's WABA, and only when `WHATSAPP_TEMPLATE_WABA_ID` matches. Business Manager still needs a scoped token (section 8.1) |
| S4 | High | Tenant association from a landlord-supplied number. | Already safe: association needs an OTP-verified account plus the one-time access code. U17 adds no shortcut, needs recorded consent and never carries the code. Phase 3 (Authentication OTP templates) can move the OTP onto WhatsApp |
| S5 | Medium | Templates could be sent after Meta recategorised or paused them. | Fixed: the send gate checks status, category and content hash. The webhooks update it at once |
| S6 | Medium | WhatsApp-only journeys missing: agent business registration, logo and verification-document upload, listing creation, photo upload, price and availability edits; landlord logo upload, adding tenants, invitations and tenancy edits; tenant tenancy-detail view in chat. Media is accepted only for maintenance photos (MIME allowlist, size limit, malware-scan hook, which is SKIPPED when no scanner is configured). | Open: product work, not done in this phase. Plan it before announcing "fully on WhatsApp" |
| S7 | Medium | No malware scanner is configured by default, so inbound WhatsApp photos are stored as `SKIPPED` scan. | Open: configure a scanner before accepting documents on WhatsApp |
| S8 | Low | Customer-typed values in templates (names, titles, reasons) could carry links or phone numbers. | Fixed: links and phone numbers are stripped, newlines removed, length capped |
| S9 | Info | Inside an open service window templates are still used, not free text. This is compliant and keeps one code path. | By design |

## 10. Production readiness checklist

1. [x] Catalogue text in the registry (S1); payloads regenerated. [ ] Approve wording changes for the 14 NEEDS_REVIEW templates, then re-run `validate` and `payloads`.
2. [ ] Meta dashboard items in section 8 done; the Tap & Order separation checked in Business Manager.
3. [ ] Migration `20261021120000_whatsapp_utility_templates` applied on staging. It builds an index on `DomainEvent`, which blocks writes to that table while it builds, so check the table size first and apply in a quiet period on production.
4. [ ] Staging env: `WHATSAPP_TEMPLATE_WABA_ID` = staging WABA, then run `sync` and check the unmanaged list shows only the expected templates.
5. [ ] With explicit approval, turn on `WHATSAPP_TEMPLATE_SUBMISSION_ENABLED=true` for one run, then `submit --keys … --confirm-waba <id>` for FINAL templates only. Turn it back off.
6. [ ] Wait for Meta, then `sync` and `report`. Record the APPROVED / PENDING / REJECTED counts. Do not resubmit rejected templates automatically: fix the text and bump the version.
7. [ ] Staging: set `WHATSAPP_UTILITY_EVENTS_SINCE` to now and trigger each wired event with authorised test numbers. Check `WhatsAppUtilityDispatch` (QUEUED or skip reason) and `MessageDelivery` (SENT, DELIVERED, READ).
8. [ ] Test STOP / START from a test phone; the next event must be skipped.
9. [ ] Test the tenant invitation on a test phone: consent recorded, link, OTP, access code, then U18.
10. [ ] Monitoring: alert on `whatsapp.utility_dispatch_failed`, `whatsapp_template.status_changed` to PAUSED, DISABLED or REJECTED, and `category_changed`.
11. [ ] Production: repeat 4–6 on the production WABA, then set `WHATSAPP_UTILITY_EVENTS_SINCE` at go-live. No other routing changes are needed: the official number and webhook stay as they are.

Phase 2 (Marketing templates) has not started and waits for authorisation.
