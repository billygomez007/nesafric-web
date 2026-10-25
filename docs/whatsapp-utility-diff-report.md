# WhatsApp Utility templates: catalogue difference report

Comparison of the 30 drafts previously in `registry.ts` (commit `63b8ba7`) with the approved U01–U30 catalogue, and what was changed. The registry now holds the catalogue text exactly. No catalogue text was changed; templates that fail a check are marked `NEEDS_REVIEW` with the proposed change in section 8.

## 1. Matching templates

**None.** Every Meta name changed (`nesafric_*` → `nes_*`) and every body changed. Twelve keys kept the same purpose with new wording: U01, U02, U07, U08, U09, U10, U11, U13, U17, U23, U28, U29. The other eighteen keys now hold a different template.

## 2. Missing templates

In the catalogue, with no draft equivalent (added): U03 viewing reminder, U05 enquiry response, U12 manager registration received, U14 business profile updated, U15 property added, U18 invitation accepted (to the landlord), U21 invitation reminder, U22 tenant link removed, U24 maintenance assigned, U27 property management assignment, U30 account status updated.

In the drafts, not in the catalogue (removed): viewing request received, rental application update, ownership details received, ownership verified, team invitation, lease ready to sign, lease fully signed, payment recorded, new repair request (landlord), listing status changed by others, workspace access changed.

Behaviour lost with them: a seeker who requests a viewing on the website no longer gets an acknowledgement (`viewing.requested`), and a landlord whose ownership claim is verified is no longer told on WhatsApp (`portfolio_verification.verified`). Both were wired before. The catalogue has no template for either.

## 3–7. Body, placeholder, button, trigger and recipient differences

"changed" in Body means the text differs. Placeholders show count before → after, with the new parameter names when they changed.

| Key | Name | Body | Placeholders | Buttons | Trigger | Recipient | Wiring before → now |
|---|---|---|---|---|---|---|---|
| U01 | `nesafric_enquiry_received` → `nes_property_enquiry_received` | changed | 3 → 3 (recipient_name, property_name, reference) | none → none | same (`marketplace.lead_created`) | same | WIRED → WIRED |
| U02 | `nesafric_viewing_confirmed` → `nes_property_viewing_confirmed` | changed | 4 → 5 (recipient_name, property_name, date, time, agent_name) | none → none | same (`viewing.confirmed`) | same | WIRED → WIRED |
| U03 | `nesafric_viewing_rescheduled` → `nes_property_viewing_reminder` | changed | 3 → 4 (property_name, date, time, reference) | none → none | `viewing.rescheduled` → `viewing.reminder_due` | same | WIRED → NOT_WIRED |
| U04 | `nesafric_viewing_cancelled` → `nes_property_viewing_rescheduled` | changed | 3 → 4 (recipient_name, property_name, date, time) | none → none | `listing.viewing_status_changed` → `viewing.rescheduled` | same | WIRED → WIRED |
| U05 | `nesafric_viewing_request_received` → `nes_property_enquiry_response` | changed | 3 → 4 (recipient_name, property_name, status, reference) | none → none | `viewing.requested` → `listing.lead_status_changed` | same | WIRED → WIRED |
| U06 | `nesafric_application_status_update` → `nes_property_viewing_cancelled` | changed | 3 → 4 (recipient_name, property_name, scheduled_for, reference) | none → none | `rental_application.status_changed` → `listing.viewing_status_changed` | same | NOT_WIRED → WIRED |
| U07 | `nesafric_business_profile_created` → `nes_agent_registration_received` | changed | 2 → 4 (recipient_name, registration_type, business_name, reference) | none → none | same (`marketplace_professional.created`) | same | WIRED → WIRED |
| U08 | `nesafric_business_verification_approved` → `nes_agent_verification_approved` | changed | 2 → 2 | none → none | same (`marketplace_professional.verification_reviewed`) | same | WIRED → WIRED |
| U09 | `nesafric_business_verification_action_required` → `nes_agent_verification_action_required` | changed | 3 → 3 (recipient_name, business_name, required_information) | none → none | same (`marketplace_professional.verification_reviewed`) | same | WIRED → WIRED |
| U10 | `nesafric_listing_submitted` → `nes_property_listing_received` | changed | 3 → 4 (recipient_name, property_title, reference, status) | none → none | same (`listing.pending_review`) | same | WIRED → WIRED |
| U11 | `nesafric_listing_review_completed` → `nes_property_listing_status` | changed | 3 → 4 (recipient_name, property_title, status, reference) | none → none | same (`listing.published | listing.rejected`) | same | WIRED → WIRED |
| U12 | `nesafric_property_ownership_received` → `nes_manager_registration_received` | changed | 2 → 4 (recipient_name, business_name, reference, status) | none → none | `portfolio_verification.created` → `organisation.created` | same | NOT_WIRED → NOT_WIRED |
| U13 | `nesafric_workspace_activated` → `nes_workspace_activated` | changed | 2 → 2 | none → none | same (`organisation.created`) | same | WIRED → WIRED |
| U14 | `nesafric_property_ownership_verified` → `nes_business_profile_updated` | changed | 2 → 3 (recipient_name, business_name, updated_information) | none → none | `portfolio_verification.verified` → `marketplace_professional.updated` | same | WIRED → NOT_WIRED |
| U15 | `nesafric_property_ownership_action_required` → `nes_property_added` | changed | 3 → 4 (recipient_name, property_name, workspace_name, property_reference) | none → none | `portfolio_verification.rejected` → `property.created` | same | WIRED → WIRED |
| U16 | `nesafric_team_invitation` → `nes_property_registration_action_required` | changed | 3 → 3 (recipient_name, property_name, required_information) | none → none | `member.invited` → `portfolio_verification.rejected` | WORKSPACE_MEMBER → LANDLORD_OR_MANAGER | NOT_WIRED → WIRED |
| U17 | `nesafric_tenant_invitation` → `nes_tenant_invitation` | changed | 3 → 4 (recipient_name, landlord_name, property_name, invitation_reference) | Link account → none | same (`tenant.access_invitation_created`) | same | WIRED → WIRED |
| U18 | `nesafric_tenancy_connected` → `nes_tenant_invitation_accepted` | changed | 2 → 4 (recipient_name, tenant_name, property_name, invitation_reference) | none → none | same (`tenant.access_invitation_redeemed`) | TENANT → LANDLORD_OR_MANAGER | WIRED → WIRED |
| U19 | `nesafric_lease_ready_to_sign` → `nes_tenant_link_confirmed` | changed | 2 → 3 (recipient_name, property_name, manager_name) | none → none | `signature.request_created` → `tenant.access_invitation_redeemed` | same | NOT_WIRED → WIRED |
| U20 | `nesafric_lease_fully_signed` → `nes_tenancy_details_updated` | changed | 2 → 4 (recipient_name, property_name, manager_name, reference) | none → none | `lease.fully_signed` → `lease.amended` | same | NOT_WIRED → WIRED |
| U21 | `nesafric_payment_recorded` → `nes_tenant_invitation_reminder` | changed | 3 → 4 (recipient_name, landlord_name, property_name, invitation_reference) | none → none | `receipt.issued` → `tenant.access_invitation_reminder_due` | same | NOT_WIRED → NOT_WIRED |
| U22 | `nesafric_tenancy_details_updated` → `nes_tenant_link_removed` | changed | 3 → 4 (recipient_name, property_name, date, contact) | none → none | `lease.amended` → `lease.terminated | lease.expired` | same | NOT_WIRED → WIRED |
| U23 | `nesafric_repair_request_received` → `nes_maintenance_request_received` | changed | 4 → 4 (recipient_name, property_name, ticket, status) | none → none | same (`maintenance.requested`) | same | WIRED → WIRED |
| U24 | `nesafric_repair_request_update` → `nes_maintenance_request_assigned` | changed | 4 → 4 (recipient_name, ticket, provider_name, status) | none → none | `maintenance.started | maintenance.rejected | maintenance.cancelled` → `workorder.assigned` | same | WIRED → WIRED |
| U25 | `nesafric_repair_request_completed` → `nes_maintenance_status_updated` | changed | 3 → 4 (recipient_name, ticket, property_name, status) | none → none | `maintenance.completed` → `maintenance.started | maintenance.rejected | maintenance.cancelled` | same | WIRED → WIRED |
| U26 | `nesafric_new_repair_request` → `nes_maintenance_request_completed` | changed | 4 → 3 (recipient_name, ticket, property_name) | none → none | `maintenance.requested` → `maintenance.completed` | LANDLORD_OR_MANAGER → TENANT | NOT_WIRED → WIRED |
| U27 | `nesafric_listing_status_changed` → `nes_property_management_assignment` | changed | 3 → 4 (recipient_name, property_name, workspace_name, reference) | none → none | `listing.status_changed` → `property.manager_assigned` | AGENT_OR_BROKER → WORKSPACE_MEMBER | NOT_WIRED → NOT_WIRED |
| U28 | `nesafric_document_received` → `nes_document_received` | changed | 3 → 4 (recipient_name, document_purpose, reference, status) | none → none | same (`listing.verification_submitted`) | same | NOT_WIRED → WIRED |
| U29 | `nesafric_document_review_completed` → `nes_document_review_completed` | changed | 3 → 4 (recipient_name, document_purpose, result, reference) | none → none | same (`listing.verification_verified | listing.verification_rejected`) | same | WIRED → WIRED |
| U30 | `nesafric_workspace_access_changed` → `nes_account_status_updated` | changed | 3 → 4 (recipient_name, profile_name, status, reference) | none → none | `member.role_changed` → `marketplace_professional.verification_reviewed` | WORKSPACE_MEMBER → AGENT_OR_BROKER | NOT_WIRED → WIRED |

Buttons: the only draft with a button was U17 ("Link account"). The catalogue has none, so it was removed. U17's body now asks the tenant to reply; that reply is handled (section 8, U17).

Recipient changes: U18 now goes to the landlord or manager (it went to the tenant); U27 goes to a workspace member; U30 to the business owner.

## 8. Utility-category compliance concerns

All 30 bodies are transactional, refer to something the recipient started or is party to, contain no promotional wording, links, emoji, OTPs or access codes, and use numbered placeholders in order. Two checks fail:

**Ends with a variable (14 templates).** Meta does not accept a body that ends with a variable, and NesAfric's validator treats a variable followed only by a full stop the same way. Affected: U03, U10, U12, U14, U15, U17, U18, U21, U23, U24, U25, U27, U28, U29.

**Too many variables for the length (8 of those).** NesAfric's rule is at least three fixed words per variable, plus three. Meta's exact threshold is not published; this is the local approximation. Affected: U10, U15, U18, U23, U24, U25, U28, U29.

Proposed minimal changes (not applied; each needs catalogue approval, and the edited text would be re-validated):

| Key | Proposed body |
|---|---|
| U03 | Reminder from NesAfric: Your viewing for {{1}} is scheduled for {{2}} at {{3}}. Your booking reference is {{4}}. Reply here if you need to make changes. |
| U10 | Hello {{1}}, your property listing {{2}} has been received. Listing reference: {{3}}. Current status: {{4}}. We will update you here when the review is complete. |
| U12 | Hello {{1}}, we have received the registration for your property management business {{2}}. Reference: {{3}}. Status: {{4}}. Reply here if you need assistance. |
| U14 | Hello {{1}}, the business profile for {{2}} has been updated successfully. Updated information: {{3}}. Reply here if you did not make this change. |
| U15 | Hello {{1}}, property {{2}} has been added to your NesAfric workspace {{3}}. Property reference: {{4}}. You can now add units and tenants for this property. |
| U17 | Hello {{1}}, {{2}} has invited you to join property {{3}} on NesAfric as a tenant. Your invitation reference is {{4}}. Reply to this message to review and verify your invitation. |
| U18 | Hello {{1}}, tenant {{2}} has accepted the invitation for property {{3}}. Reference: {{4}}. The tenant can now view their tenancy details and request maintenance. |
| U21 | Hello {{1}}, your invitation from {{2}} to join property {{3}} on NesAfric is still pending. Your invitation reference is {{4}}. Reply here to continue. |
| U23 | Hello {{1}}, your maintenance request for property {{2}} has been received. Ticket: {{3}}. Status: {{4}}. We will update you here as it progresses. |
| U24 | Hello {{1}}, your maintenance request {{2}} has been assigned to {{3}}. Current status: {{4}}. We will update you here as the work progresses. |
| U25 | Hello {{1}}, maintenance ticket {{2}} for property {{3}} has been updated. New status: {{4}}. Reply here if you have any questions about this request. |
| U27 | Hello {{1}}, you have been assigned to manage property {{2}} under workspace {{3}}. Assignment reference: {{4}}. Reply here if you have any questions. |
| U28 | Hello {{1}}, your document for {{2}} has been received by NesAfric. Reference: {{3}}. Status: {{4}}. We will update you here when the review is complete. |
| U29 | Hello {{1}}, the review of your document for {{2}} is complete. Result: {{3}}. Reference: {{4}}. Reply here if you have any questions about the result. |

Other concerns:

- **U17 and U21 (tenant invitation and reminder):** the recipient's number comes from the landlord. Both require `TENANT_CONSENT_RECORDED` (the landlord recorded the tenant's agreement to WhatsApp contact), and STOP overrides it. The reference `TI-xxxxxx` is derived from the invitation's id, never from the access code. Replying to U17 only explains how to verify (link the number with a one-time code, then send the access code); nothing is linked by replying. U21 is a reminder to someone who has not yet engaged, which Meta is most likely to recategorise as Marketing: send at most one per invitation, and only after U17 was delivered.
- **U15, U13, U07, U10, U28:** confirm the recipient's own action. They are Utility, and they are not sent while the person is chatting with NesAfric (the chat already confirms it). U15 sends at most one message per workspace per 10 minutes, so a bulk import does not send one per property.
- **U09, U16:** `{{3}}` is the reviewer's note, typed by staff; links and phone numbers are removed and it is capped at 160 characters.
