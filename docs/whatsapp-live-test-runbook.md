# Controlled real-phone test runbook (WhatsApp)

**Status: NOT RUN.** This is a procedure for a later, separately approved test window. Nothing here has been executed against Meta or real phones for the release candidate. Run it only with explicit approval for each Meta change and for live replies.

## Scope

1. Tenant flows: tappable menu, repair report with a photo, request number, STOP and START.
2. Landlord flows: onboarding with unit lists (`A1, A2, A3`, `B1, 3 bedroom apartment`), pause and resume, then a property listing with photos submitted for review.
3. Agency, agent and service-provider registration with a logo and replacement; Super Admin approval; property listing (10 photos, an 11th refused, remove, cover, confirm); service listing.
4. A stale confirmation after a website edit.
5. A decision notice on WhatsApp (only if the NOTIFICATION template is approved).

## Test identities

| Role | Phone | Account (created by the setup script) |
|---|---|---|
| Landlord | 0231582898 | `whatsapp-landlord-233231582898@nesafric.test` (no organisation until onboarding) |
| Tenant | 0206655012 | `tenant-233206655012@nesafric.test`, tenant of "Local Test Homes", its own Palm Court property, unit A1, active lease |
| Business owner | third phone, for example 024xxxxxxx | `whatsapp-business-<number>@nesafric.test` (no business: registers agency, agent or provider) |
| Super Admin | your own local web account | promote it with `npx tsx scripts/bootstrap-platform-admin.ts <email> SUPER_ADMIN` |

To test the agent and the provider separately from the agency, relink the business-owner phone to a second fixture account between rounds. One account holds one agency or agent profile and one provider.

## Prerequisites

- **Code:** the release candidate branch (`release/whatsapp-business-rc`) checked out, `npm ci`.
- **Database:** a throwaway local database built from all migrations:

  ```bash
  bash scripts/create-isolated-test-database.sh nesafric_live_rc_test
  ```

  Never use `propertyos` or any shared database.
- **`.env.local`:**
  - `WHATSAPP_PROVIDER_ACCESS_TOKEN`: a system-user token. Prefer one limited to `whatsapp_business_messaging` and `whatsapp_business_management` on the NesAfric account.
  - `WHATSAPP_APP_SECRET`, `WHATSAPP_GRAPH_API_VERSION`.
  - `WHATSAPP_LOCAL_PHONE_NUMBER_ID`, `WHATSAPP_LOCAL_BUSINESS_ACCOUNT_ID`, `WHATSAPP_LOCAL_VERIFY_TOKEN`.
- **Routing:**
  - Today the number reports to Kora's app callback (`api.koraafric.com`).
  - The test uses a temporary phone-number override only, approved per window, with automatic removal.
  - Do not change the app callback or subscriptions.
  - Confirm with the Kora team that it ignores NesAfric events first (see the audit).
- **Tunnel:**

  ```bash
  ngrok http 3000 --traffic-policy-file scripts/ngrok-whatsapp-webhook-only.yml
  ```

  Every path except `/api/webhooks/whatsapp` must return 404, and an unsigned POST must return 401.
- **Server:** start it with:
  - `DATABASE_URL` pointing at the throwaway database;
  - `WHATSAPP_OFFICIAL_ORGANISATION_ID` from the setup script;
  - `STORAGE_PROVIDER=local`;
  - `WHATSAPP_INBOUND_ALLOWLIST=<the test phones>`.

  Leave `WHATSAPP_INLINE_PROCESSING` unset for live replies. Run the worker with the same variables for jobs:

  ```bash
  npx tsx --env-file=.env --env-file=.env.local scripts/run-worker.ts
  ```

- **Disk:** at least 5 GB free (the build and dependencies).

## Setup

```bash
DATABASE_URL='postgresql://…/nesafric_live_rc_test?schema=public' npx tsx scripts/setup-local-whatsapp.ts --database nesafric_live_rc_test --landlord 0231582898 --tenant 0206655012 --business <third phone>
```

Record the printed official organisation ID.

## Window procedure (20 minutes per window)

1. Save the current configuration. It must show only the app callback (Kora):

   ```
   GET /<phone-number-id>?fields=webhook_configuration
   ```

2. Set the override:

   ```
   POST /<phone-number-id>  {"webhook_configuration":{"override_callback_uri":"<tunnel>/api/webhooks/whatsapp","verify_token":"<token>"}}
   ```

   Read it back: `phone_number` must equal the tunnel and `application` must still be Kora.
3. Arm automatic removal 20 minutes later:

   ```
   POST /<phone-number-id>  {"webhook_configuration":{"override_callback_uri":""}}
   ```

4. Run the checks below. Watch `Message`, `MessageDelivery` (status and `providerReference`), `WhatsAppFlowDraft` and the domain tables.
5. Remove the override if it is still in place. Read it back: only `application` (Kora) may remain.

## Checks and expected results

Record three kinds of evidence separately: Meta accepted the message (`providerReference` set), Meta's delivery callbacks (`DELIVERED`/`READ`), and the tester confirming it on the phone.

| # | Phone | Send | Expected reply | Expected database and admin state |
|---|---|---|---|---|
| T1 | Tenant | `hi`, then tap a row in "Choose an option" | Welcome list; the tapped row's answer | Outbound has `whatsappInteractive`; inbound body is the row id |
| T2 | Tenant | `The kitchen sink pipe is leaking`, then a photo, `done`, Confirm | Photo saved; request NM-xxxx | One `MaintenanceRequest` with `intakeReference` `whatsapp:<id>`; one `MaintenanceAttachment` (`sourceMediaId` `whatsapp:<media id>`); the stored image has no EXIF |
| T3 | Tenant | `STOP`, then `START` | Unsubscribed, then subscribed | `ChannelIdentity.optedOutAt` set, then cleared; drafts untouched |
| L1 | Landlord | `register`, `1`, name, property, area, `skip`, blocks `A, B`, units `A1, A2, A3`, then `B1, 3 bedroom apartment` and `B2, studio` on separate lines | "Saved … 2 buildings, 5 units" | `OnboardingDraft` holds the units with the parsed types and bedrooms |
| L2 | Landlord | `pause`, then `register` | Continues at the same question | Same draft, same step |
| L3 | Landlord (after onboarding) | `list a property`, follow it with an authority reference, 1 photo, `done`, Confirm | "Submitted for review … not yet published" | `Listing` `PENDING_REVIEW`, verification `PENDING`, 1 photo with a cover; it appears in the Super Admin listing review queue |
| B1 | Business owner | `register agency`, answers, logo image, `edit` → Logo → another image, Confirm | Submitted for review; logo saved | `MarketplaceProfessional` `PENDING` with an evidence reference and `logoUrl` set; it appears in the Super Admin professionals queue; the draft is `SUBMITTED` |
| B2 | Super Admin (web) | Approve the professional | — | `VERIFIED`; WhatsApp notice queued only if the template is configured (otherwise none, and the email path is unchanged) |
| B3 | Business owner | `list a property`, answers, 10 photos, 11th photo, `remove 2`, a new photo, `cover 3`, `done`, Confirm | Photo n of 10; 11th refused; removed; cover set; submitted | `Listing` `PENDING_REVIEW` with 10 photos and exactly one cover; nothing `PUBLISHED` |
| B4 | Business owner + web | Start a second listing, reach the review, edit its title on the website, then press Confirm on WhatsApp | "Changed after you reviewed it"; `done`, then `reload` | Listing stays `DRAFT` until re-reviewed |
| P1 | Business owner (relinked to a fresh account) | `register services`, answers, Confirm; Super Admin approves; `list my services`, pricing, 3 images, `done`, Confirm | Submitted; then "published" | `ServiceProvider` `PENDING`, then `VERIFIED`; `ProviderMarketplaceProfile.listed` true with `pricingModel` set; 3 `ProviderPortfolioImage` rows |
| X1 | Any | A photo with no draft active | "Isn't clear which draft …" | Nothing attached |

## Cleanup

1. Remove the override and read it back.
2. Stop the tunnel, the server and the worker.
3. Drop the throwaway database:

   ```bash
   dropdb --force nesafric_live_rc_test
   ```

4. Delete the local storage folder, and the dev and tunnel logs (they hold message text).
5. Revert `AGENTS.md` if `next dev` rewrote it.

## Rollback

- **Override removal fails:**
  1. Retry the `override_callback_uri: ""` request with a valid token.
  2. If the token is invalid, clear the phone number's webhook override in Meta's WhatsApp Manager.
  3. Do not leave the override pointing at a stopped tunnel: Meta retries and then drops messages for the number.
- **Unexpected messages to real customers:** stop the server at once. The inbound allowlist keeps other senders from being stored or answered; check `MessageDelivery` for any recipient outside the test phones.
- **Database:** only the throwaway database is touched; dropping it is the rollback.
