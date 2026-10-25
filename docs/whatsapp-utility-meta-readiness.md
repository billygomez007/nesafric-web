# WhatsApp Utility templates: Meta readiness

Status on 21 October 2026, branch `claude/vibrant-cray-ei6kmy`. **Nothing has been submitted to Meta.** Every result here is local validation; Meta alone decides approval and category.

## Summary

| | Count |
|---|---|
| Templates | 30 |
| Matching the catalogue (registry text = catalogue text) | 30 |
| Modified from the earlier drafts | 30 |
| FINAL (local checks pass) | 16 |
| NEEDS_REVIEW (catalogue text fails a local check) | 14 |
| Submitted to Meta | 0 |
| Approved by Meta | 0 |
| Wired to business events | 25 |
| Awaiting event implementation | 5 (U03, U12, U14, U21, U27) |

## Per-template readiness

| Key | Name | Content | Local errors | Wiring |
|---|---|---|---|---|
| U01 | `nes_property_enquiry_received` | FINAL | none | WIRED |
| U02 | `nes_property_viewing_confirmed` | FINAL | none | WIRED |
| U03 | `nes_property_viewing_reminder` | NEEDS_REVIEW | Body must not end with a placeholder. | NOT_WIRED |
| U04 | `nes_property_viewing_rescheduled` | FINAL | none | WIRED |
| U05 | `nes_property_enquiry_response` | FINAL | none | WIRED |
| U06 | `nes_property_viewing_cancelled` | FINAL | none | WIRED |
| U07 | `nes_agent_registration_received` | FINAL | none | WIRED |
| U08 | `nes_agent_verification_approved` | FINAL | none | WIRED |
| U09 | `nes_agent_verification_action_required` | FINAL | none | WIRED |
| U10 | `nes_property_listing_received` | NEEDS_REVIEW | Body must not end with a placeholder. Too many parameters for the length of the message (Meta rejects these). | WIRED |
| U11 | `nes_property_listing_status` | FINAL | none | WIRED |
| U12 | `nes_manager_registration_received` | NEEDS_REVIEW | Body must not end with a placeholder. | NOT_WIRED |
| U13 | `nes_workspace_activated` | FINAL | none | WIRED |
| U14 | `nes_business_profile_updated` | NEEDS_REVIEW | Body must not end with a placeholder. | NOT_WIRED |
| U15 | `nes_property_added` | NEEDS_REVIEW | Body must not end with a placeholder. Too many parameters for the length of the message (Meta rejects these). | WIRED |
| U16 | `nes_property_registration_action_required` | FINAL | none | WIRED |
| U17 | `nes_tenant_invitation` | NEEDS_REVIEW | Body must not end with a placeholder. | WIRED |
| U18 | `nes_tenant_invitation_accepted` | NEEDS_REVIEW | Body must not end with a placeholder. Too many parameters for the length of the message (Meta rejects these). | WIRED |
| U19 | `nes_tenant_link_confirmed` | FINAL | none | WIRED |
| U20 | `nes_tenancy_details_updated` | FINAL | none | WIRED |
| U21 | `nes_tenant_invitation_reminder` | NEEDS_REVIEW | Body must not end with a placeholder. | NOT_WIRED |
| U22 | `nes_tenant_link_removed` | FINAL | none | WIRED |
| U23 | `nes_maintenance_request_received` | NEEDS_REVIEW | Body must not end with a placeholder. Too many parameters for the length of the message (Meta rejects these). | WIRED |
| U24 | `nes_maintenance_request_assigned` | NEEDS_REVIEW | Body must not end with a placeholder. Too many parameters for the length of the message (Meta rejects these). | WIRED |
| U25 | `nes_maintenance_status_updated` | NEEDS_REVIEW | Body must not end with a placeholder. Too many parameters for the length of the message (Meta rejects these). | WIRED |
| U26 | `nes_maintenance_request_completed` | FINAL | none | WIRED |
| U27 | `nes_property_management_assignment` | NEEDS_REVIEW | Body must not end with a placeholder. | NOT_WIRED |
| U28 | `nes_document_received` | NEEDS_REVIEW | Body must not end with a placeholder. Too many parameters for the length of the message (Meta rejects these). | WIRED |
| U29 | `nes_document_review_completed` | NEEDS_REVIEW | Body must not end with a placeholder. Too many parameters for the length of the message (Meta rejects these). | WIRED |
| U30 | `nes_account_status_updated` | FINAL | none | WIRED |

## Verified in code

- **Correct WABA, never Tap & Order's:** sync and submission act only on the WABA recorded on the official NesAfric number assignment (`WHATSAPP_OFFICIAL_ORGANISATION_ID`), and only when `WHATSAPP_TEMPLATE_WABA_ID` names the same WABA. `submit` also needs `--confirm-waba <id>` typed again. No Tap & Order reference exists in code or configuration.
- **Submission switched off by default:** `WHATSAPP_TEMPLATE_SUBMISSION_ENABLED=true` is required for a run. NEEDS_REVIEW and invalid templates, rejected templates and templates already on Meta are never submitted; approved templates are never overwritten.
- **Approval safeguard at send time:** status APPROVED, category UTILITY and a content hash equal to the registry's. Pause, disable or recategorisation (webhooks) stops sends at once.
- **Template webhooks:** `message_template_status_update`, `template_category_update`, `message_template_quality_update`, accepted for the official WABA only, signature-checked (`X-Hub-Signature-256`, constant time).
- **Placeholders:** sequential `{{n}}`, matching the parameter list, realistic samples, maximum lengths; typed values lose links, phone numbers and newlines.
- **Opt-in and STOP:** per-template opt-in basis; STOP checked at dispatch and again at queue time.
- **Tenants:** no tenancy is connected from a phone number. Connection needs an account that proved the number with a one-time code plus the landlord's access code; U17 needs recorded consent and never carries the code.
- **Tokens:** sent only to `https://graph.facebook.com`, never logged or printed.

## Not verifiable here (needs Meta Business Manager or credentials)

1. The NesAfric WABA ID and phone number ID, and that they are on the official `WhatsAppNumberAssignment`.
2. System-user token permissions: `whatsapp_business_management` and `whatsapp_business_messaging`; ideally a token that reaches only the NesAfric WABA, separate from Tap & Order.
3. App webhook subscriptions: `messages`, `message_template_status_update`, `template_category_update`, `message_template_quality_update`.
4. Business verification, approved display name, messaging tier, payment method.
5. Staging WABA or number with authorised test recipients.

## Submission (after authorisation)

```bash
WHATSAPP_TEMPLATE_SUBMISSION_ENABLED=true npm run whatsapp:templates -- submit --keys U01,U02,U04,U05,U06,U07,U08,U09,U11,U13,U16,U19,U20,U22,U26,U30 --confirm-waba <NesAfric WABA ID>
```

Then `sync` and `report` until Meta decides. Rejected templates are not resubmitted: fix the text, bump the version.
