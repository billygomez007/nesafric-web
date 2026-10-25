# WhatsApp Utility Phase 1: completion pass

Status on 21 October 2026, branch `claude/vibrant-cray-ei6kmy`. Nothing was submitted to Meta, no live message was sent, and no production setting or routing was changed.

**Verdict: Phase 1 is ready for a first Meta submission of 16 templates, after authorisation.** The approved catalogue is now in the registry: 16 templates are FINAL, 14 are NEEDS_REVIEW (catalogue text fails a local check). Seven of the ten WhatsApp journeys are still partial or missing (section 3).

Contents:

1. What changed in this pass
2. Template catalogue and readiness
3. WhatsApp workflow matrix
4. Notification wiring (unwired templates)
5. Meta configuration checklist
6. Test results
7. Remaining blockers

---

## 1. What changed in this pass

- **Merged `release/whatsapp-business-rc` into this branch.** This branch started from `main` and did not have the WhatsApp business registration, listing and photo flows. Those flows exist only on the release candidate. Three conflicts were resolved by keeping both sides: `prisma/schema.prisma` (template state models + flow draft models), `scripts/run-worker.ts` and `src/app/api/jobs/run/route.ts` (utility dispatch + daily cleanup). Both migrations (`20261020090000_whatsapp_business_flows`, `20261021120000_whatsapp_utility_templates`) apply in order on a fresh database.
- **Fixed a duplicate notification that the merge introduced.** The release candidate tells agents and listing owners about review decisions through the generic `NOTIFICATION` template (`src/modules/whatsapp-assistant/notify.ts`). U08, U09 and U11 report the same decisions. With both live, the recipient would get two messages. The generic message now steps aside for a decision while its Utility template is live (utility dispatch on and Meta approved the registry text), and still sends otherwise. Service-provider decisions and agent suspensions have no Utility template, so they keep the generic message. Test: `sends a verification decision once` in `tests/postgres-whatsapp-utility-templates.integration.test.ts`.

## 2. Template catalogue and readiness

The catalogue was supplied and is in the registry exactly. See `docs/whatsapp-utility-catalogue.md`, `docs/whatsapp-utility-diff-report.md` and `docs/whatsapp-utility-meta-readiness.md`.

## 3. WhatsApp workflow matrix

"Linked" means the WhatsApp number is linked to a NesAfric account with a one-time code (SMS or email). That rule is kept on every journey.

| # | Journey | Status | What works in WhatsApp | What is missing |
|---|---|---|---|---|
| 1 | Agent and broker business registration | PARTIAL | Agency, agent and service-provider registration, one question at a time, with edit, pause and cancel. Submitted to the existing admin verification. | A person without a NesAfric account is sent to `/register` on the website. Creating the account itself is not possible in WhatsApp. |
| 2 | Business logo and verification documents | PARTIAL | Logo upload (decoded and re-encoded, metadata stripped). | Verification is a typed reference only, not a document. Agents have no document upload service; providers have `uploadProviderEvidenceDocument`, but WhatsApp does not use it. Needs a malware scanner before documents are accepted (finding S7). |
| 3 | Listing creation, editing and photos | PARTIAL | Create a listing, up to 10 photos, remove a photo, choose the cover, edit answers before submitting, reload after a website edit. Enters the existing admin review. | An already submitted or published listing cannot be opened and edited in WhatsApp. "photos" shows numbers and a website link, not the images. |
| 4 | Landlord and property manager onboarding | COMPLETE | Workspace (new or existing), owner or manager role, properties, units, tenants, ownership claim, provider invitations. | Ownership documents cannot be uploaded (claim only). |
| 5 | Adding properties and units | PARTIAL | New properties and their units through onboarding, including into an existing workspace. | Adding a unit to an existing property was not verified as a separate WhatsApp action. |
| 6 | Tenant invitation and verified onboarding | PARTIAL | Landlord adds tenants with draft leases in onboarding. Tenant links with OTP, then redeems the access code in WhatsApp. U17 invitation from the website event (template not approved). | The landlord cannot create the access invitation or record the tenant's WhatsApp consent from WhatsApp. |
| 7 | Editing tenancy information | NOT IMPLEMENTED | — | No WhatsApp action changes lease dates, rent, unit or tenant contact details. |
| 8 | Tenant access to tenancy details | PARTIAL | "account" shows the tenant's own property, unit, status and end date. | Rent, payment status, receipts and the lease document are not shown. |
| 9 | Property search with photos, prices and locations | PARTIAL | Search by rent/buy, area, budget and category. Results show price and location, three at a time, with more. | Photos are not sent; "details" gives a website link. |
| 10 | Viewing requests and confirmations | PARTIAL | Seeker requests a viewing in chat and gets a reference. U02/U03/U04 tell the seeker about confirmation, rescheduling and cancellation (templates not approved). | The agent or landlord cannot confirm, move or cancel a viewing from WhatsApp. The seeker must type the time as an ISO timestamp with a UTC offset. |

## 4. Notification wiring

Superseded by the catalogue: 25 of 30 templates are wired to existing domain events; U03, U12, U14, U21 and U27 are not, with reasons. See `docs/whatsapp-utility-templates-phase1.md`, section 6.

## 5. Meta configuration checklist

Verified in code:

- [x] Template management acts only on the official assignment's WABA, and only when `WHATSAPP_TEMPLATE_WABA_ID` names the same WABA.
- [x] Submission needs `WHATSAPP_TEMPLATE_SUBMISSION_ENABLED=true` and `--confirm-waba <id>`; drafts, NEEDS_REVIEW and invalid templates, flagged templates (without `--acknowledge`), rejected and already approved templates are refused.
- [x] Sending needs status APPROVED, category UTILITY and the same content hash as the registry. Pause, disable and recategorisation stop sends at once through the webhooks.
- [x] Template webhooks handled: `message_template_status_update`, `template_category_update`, `message_template_quality_update`.
- [x] Placeholders: positional `{{n}}`, matched to `params`, with samples and length limits; customer values sanitised.
- [x] Opt-in per template (ENQUIRY_OPT_IN, LINKED_ACCOUNT, TENANT_CONSENT_RECORDED); STOP overrides every basis and is checked at queue time.
- [x] Tap & Order: no reference in code or configuration other than the isolation comments; no other WABA is read or written.
- [x] Graph API calls go only to `https://graph.facebook.com`; the token is never logged.

Needs the Meta dashboard or credentials (not done here):

- [ ] Confirm the NesAfric WABA ID and phone number ID in Business Manager, and that they are recorded on the official `WhatsAppNumberAssignment`.
- [ ] Confirm the system user token has `whatsapp_business_management` and `whatsapp_business_messaging`, and ideally reaches only the NesAfric WABA.
- [ ] Subscribe the app webhook to `messages`, `message_template_status_update`, `template_category_update`, `message_template_quality_update`.
- [ ] Business verification, display name, messaging tier and payment method.
- [ ] Separate Tap & Order's app, WABA and system user in Business Manager.

**Final submission payloads:** `docs/whatsapp-utility-template-payloads.json` (`eligible`: the 16 FINAL templates; `needsReview`: the other 14, not submittable).

## 6. Test results

Full suite on the merged branch with the catalogue, run like CI (fresh PostgreSQL database built with `scripts/bootstrap-fresh-database.sh`, seeded, CI `SESSION_SECRET`): **183 files, 1363 tests, all passing**. That is the earlier 1303, plus the release candidate's business-flow tests, plus the new duplicate-notification test. Typecheck clean; lint clean on the changed files.

WhatsApp integration tests in that run include: utility templates (11), business registration, business listing, service listing, onboarding, maintenance, official router, webhook hardening and interactive menus.

Not run: staging workflow tests and WhatsApp tests against real Meta. They need staging WABA credentials, authorised test numbers and approved templates.

## 7. Remaining blockers

1. **Catalogue changes** for the 14 NEEDS_REVIEW templates (proposals in the difference report).
2. **Journey gaps** in section 3: account creation, verification documents, editing published listings, tenant invitations and consent from WhatsApp, tenancy edits, fuller tenant details, search photos, agent-side viewing actions.
3. **Scheduled reminders** for U03 and U21; U12, U14 and U27 have no event to attach to.
4. **Malware scanner** must be configured before documents are accepted on WhatsApp.
5. **Meta dashboard checks** in section 5.
6. **Staging tests** with authorised numbers after approval.
