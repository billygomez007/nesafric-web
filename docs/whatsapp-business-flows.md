# WhatsApp business registration and listings

Release notes and limitations for the WhatsApp flows on the official NesAfric number:
business registration (agency, agent, service provider), property listings and service
listings. Operations and number routing: `docs/whatsapp-operations.md`. Live test procedure:
`docs/whatsapp-live-test-runbook.md`.

## Release decisions (deliberate limitations)

| Decision | Effect |
|---|---|
| Agencies and agents must be approved before submitting listings on WhatsApp | They can prepare a listing (a DRAFT listing with photos) while their profile is pending. Confirming it is refused, and the draft kept, until the profile is `VERIFIED` and `ACTIVE`. This is stricter than the website, where an unverified professional can submit a listing for review. |
| Business application drafts are WhatsApp-only | An agency, agent or provider registration in progress lives in `WhatsAppFlowDraft` and is not visible on the website. The profile appears on the website (and to Super Admins) only when submitted. |
| Property listing drafts continue on the website | Before photos, the flow creates the canonical DRAFT listing. It can be edited on the website (`/pro/<id>/listings/<listingId>/edit` or `/listings/<listingId>/edit`). Changes made there are never overwritten from WhatsApp; the person is asked to reply `reload`. |
| Hotels and short stays are website-only | Nightly prices, guest limits and house rules are not asked on WhatsApp. |
| Property listings need the existing admin review before publication | Confirming a property listing on WhatsApp submits it for review (`PENDING_REVIEW`). It is published only when a Super Admin verifies and publishes it; WhatsApp never verifies or publishes a property listing. |
| Service listings publish only for approved, unsuspended providers | Confirming a service listing publishes the provider's marketplace profile immediately (`listed = true`) only when the provider is `VERIFIED` and not suspended at that moment. Otherwise it is saved with `listed = false` and goes live once approved. Accepting work also requires approval (existing rule). |
| Landlords keep the existing onboarding | `register` on WhatsApp. Landlords list their own properties. Like every listing, they must give an authority reference. |
| Agencies and agents send verification documents on WhatsApp | An agency sends a photo or PDF of its business registration certificate; an individual agent sends photos of the front and back of their Ghana Card. Each is stored PRIVATE (`MarketplaceProfessionalDocument`), readable only by the profile's owners and admins and by NesAfric reviewers with `marketplace.verify`, who open it from Platform admin → Professionals. Nothing is submitted for review until every required document is stored; a file WhatsApp can't deliver is asked for again. |
| Landlords can invite current tenants from WhatsApp | After adding tenants, the landlord is asked whether they live in the units now and agreed to WhatsApp messages. On yes, each tenant with a phone gets an invitation (U17) and the landlord gets each tenant's access code. Leases stay drafts until lease execution. A tenant who redeems the code can report repairs on a draft tenancy that has started (`src/modules/tenants/reportable-lease.ts`); the report goes to that landlord for that property. Nothing else treats the draft as a current lease. |

## Limits and rules

- **Photos.** At most 10 per listing on every path: the website upload, bulk listing writes and WhatsApp.
  - The limit is counted under the listing row lock.
  - Listings saved before the limit keep their extra photos but cannot add more.
  - Other media (videos, floor plans) count towards the existing 12-item total.
- **Portfolio images.** At most 10 per provider. The logo is separate.
- **Images.** Every JPEG, PNG and WebP upload is fully decoded with sharp, turned upright and re-encoded without metadata (EXIF, GPS, XMP, IPTC, comments).
  - Refused: damaged, truncated or mislabelled files; photos under 200 px or logos under 64 px; images over 12,000 px.
  - Public photos are resized to at most 2,560 px.
  - HEIC (private evidence only) is stored as uploaded and stays private.
- **Listing storage keys.** A listing may only name stored files uploaded to that listing. Another listing's or organisation's file is refused, and removing a photo deletes only the listing's own file.
- **Drafts.**
  - One open draft per sender, linked account and flow.
  - A message is applied once.
  - Drafts expire after 14 days without activity.
  - An image is attached only to the active draft at a photo or logo step; otherwise the person is asked to resume first.
- **Confirmation.** The Confirm button names the draft revision reviewed. Listing submission also checks the listing revision under its lock. Any edit to details, photos or amenities (website or WhatsApp) after the review makes the confirmation stale.
- **Accounts.** A WhatsApp number must be linked to a NesAfric account (existing OTP linking). A phone number or a business name alone grants nothing.
- **AI.** It may only rephrase a description the person wrote. Output that adds numbers, prices, claims or links is discarded, and nothing is used without confirmation.
- **Cleanup.**
  - Runs daily (worker and `/api/jobs/run`).
  - Expires lapsed drafts.
  - Deletes files of listing photos, portfolio images and archived logos that nothing references, after 24 hours.
  - Each file is locked, re-checked and marked before deletion.
  - Evidence, attachments, inspection media, application documents and campaign creative are never cleaned.

## Notifications

Super Admin decisions on agencies, agents, providers and listings are also sent on WhatsApp to linked numbers. They use the approved NOTIFICATION template (`WHATSAPP_TEMPLATE_NOTIFICATION`) through the existing sender, which respects opt-out (STOP).

Without the template, or without an official number, nothing is queued; the reason is returned and email continues as before. A queued message is not proof of delivery: see the `MessageDelivery` status and Meta's delivery callbacks.

## Deployment

1. **Migrations,** in order, after the earlier launch migrations:
   - `20261019150000_maintenance_intake_reference`
   - `20261019180000_maintenance_attachment_source_media`
   - `20261020090000_whatsapp_business_flows`, which adds the draft and portfolio tables, `Listing.revision` with its triggers, `ListingMedia.sourceMediaId` and `ProviderMarketplaceProfile.pricingModel`.

   All are additive. Rollback SQL is in the migration's `ROLLBACK.md`.
2. **Dependency:** `sharp@0.35.5`.
   - Next.js loads it as a server-external package.
   - The lockfile includes the Linux x64 binaries Vercel installs.
   - Upload routes run on the Node.js runtime, never Edge.
3. **Environment:** no new variables. Decision notices need `WHATSAPP_TEMPLATE_NOTIFICATION`, set to an approved template.
4. **Scheduling:** run the worker or the cron, so the daily cleanup is queued and run.
