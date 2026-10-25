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

## Preflight status (read-only, 2026-10-20)

| Item | Status |
|---|---|
| Release candidate | `release/whatsapp-business-rc`; automated suite green |
| Webhook routing | Number 1304923409378538 (+233 50 282 0002) in WABA 1104581892174096 sends to the Tap & Order app callback `api.koraafric.com`. There is no phone or WABA override. **A temporary per-number override is needed for each window.** |
| Kora dependency | Its production endpoint only acknowledges and drops these events (see the audit). Owner and Kora approval of the routing plan is **pending**. |
| Display name and quality | `NesAfric` approved; quality GREEN; account LIVE |
| Token | Valid system-user token on the Tap & Order app, no expiry. Its scopes are broader than needed (`business_management`, all assets). Acceptable for a local test; narrow it before production. |
| Templates | **None** on the NesAfric WABA, so decision notices on WhatsApp cannot be sent (step 10 expects no message) |
| Test environment | Throwaway database `nesafric_live_rc_test` built from all migrations with no drift. Landlord and tenant fixtures linked. Nothing queued to send. The business-owner fixture needs a third phone number. |
| Tunnel | ngrok installed and authenticated; webhook-only policy in `scripts/ngrok-whatsapp-webhook-only.yml` |
| Vercel | **Blocked**: every URL on `nesafric.com` returns HTTP 402 |
| GitHub Actions | **Blocked**: recent runs end in `startup_failure` (account level) |
| Worker and cron | `vercel.json` runs `/api/jobs/run` every 5 minutes, which needs a paid Vercel plan (Hobby runs once a day). For the local test, run `scripts/run-worker.ts`. |
| Migrations | The local test database has all of them. Production has **not** been migrated: `20261019150000`, `20261019180000` (already merged to `main`) and `20261020090000` are pending there. Production status cannot be read from here. |

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

## Phone-test script (all NOT RUN)

Every step is **NOT RUN** until performed in an approved window. Record three kinds of evidence separately for each reply:
- **(a)** Meta accepted it: `MessageDelivery.providerReference` is set and the status is `SENT`.
- **(b)** Meta's callbacks: `DELIVERED` and `READ`.
- **(c)** The tester confirms what appeared on the phone.

Phones: **T** = tenant 0206655012, **L** = landlord 0231582898, **B** = business owner (a third phone, linked with `--business`), **A** = Super Admin on the local website.

**Window 1: tenant, STOP/START, landlord**

1. **Tenant menu.** T sends `hi`, then taps "Choose an option" and picks *Check my request*.
   - **WhatsApp:** the welcome list with a button; then the request status reply.
   - **Database:**
     - The outbound `Message.metadata.whatsappInteractive` is present.
     - The inbound body is the tapped row id (`7`).
   - **Cleanup:** none.
2. **Tenant repair report.** T sends `The kitchen sink pipe is leaking`, then one photo, then `done`, then taps **Confirm**.
   - **WhatsApp:** "Send up to 5 photos…", a photo acknowledgement, the summary, then "Request NM-xxxx is logged with Local Test Homes".
   - **Database:**
     - One `MaintenanceRequest` with `intakeReference` = `whatsapp:<message id>`, the tenant's property and unit, and `intakeChannel` WHATSAPP.
     - One `MaintenanceAttachment` whose `sourceMediaId` = `whatsapp:<media id>`.
     - The stored image has no EXIF.
   - **Cleanup:** the database is dropped at the end.
3. **STOP and START.** T sends `STOP`, then `START`.
   - **WhatsApp:** "You have unsubscribed…", then "You are subscribed … again".
   - **Database:** `ChannelIdentity(+233206655012).optedOutAt` is set, then cleared. No business-initiated message is queued while opted out.
   - **Cleanup:** none (ends subscribed).
4. **Landlord onboarding with unit lists.** L sends:
   - `register` → `1` → `Owusu Homes` → `Palm Court` → `East Legon` → `skip`;
   - `A, B` (blocks);
   - `A1, A2, A3` (units in A);
   - `B1, 3 bedroom apartment` and `B2, studio` on separate lines (units in B).

   - **WhatsApp:** one question per step; after block B, "Saved Palm Court: 2 buildings, 5 units".
   - **Database:** `OnboardingDraft` has A1–A3 with no type, B1 apartment with 3 bedrooms, and B2 studio.
   - **Cleanup:** none.
5. **Pause and resume.** L sends `pause`, then `register`.
   - **WhatsApp:** "Your onboarding is saved…", then the same next question.
   - **Database:** same draft, same `step`.
   - **Cleanup:** none.
6. **Landlord completes onboarding.** L replies `no` (no more properties) and `later` (no tenants), then answers the reminder, professionals, approval-limit and emergency-contact questions, and confirms the summary.
   - **WhatsApp:** "Saved. Owusu Homes: 1 property, 5 units, 0 tenants…".
   - **Database:** an `Organisation` (INDIVIDUAL_LANDLORD) with the property and its 5 units; the draft is `COMMITTED`.
   - **Cleanup:** none.
7. **Landlord property listing.** L sends:
   - `list a property`;
   - the property and unit number, `1` (rent), `1` (apartment), a title, `1` (Greater Accra), `Accra`, `skip`, `3000`, `2` (monthly), `2`, `1`, `skip`, `skip`;
   - a description, then `next`;
   - `1` (I own the property), `4` (ownership reference), `Land title GA-12345`;
   - one photo, `done`, then **Confirm**.

   - **WhatsApp:** "Photo 1 of 10 added.", the review with "not published until NesAfric approves it", then "Submitted for review. Status: submitted for review (not yet published)".
   - **Database:**
     - `Listing` is `PENDING_REVIEW` with verification `PENDING`, 1 photo and a cover.
     - It appears in the Super Admin listing review queue.
     - It is **not** `PUBLISHED`.
   - **Cleanup:** none.

**Window 2: agency registration, approval, listing rules**

8. **Agency registration with a logo and replacement.** B sends:
   - `register agency`, `1`, `Accra Prime Realty`, `skip`, an email, `1`, `Osu`, a description, `Osu, Labone`, `BN-552211`;
   - logo image 1;
   - at review: `edit` → the Logo number → logo image 2;
   - then **Confirm**.

   - **WhatsApp:** one question per step; "Logo received." twice; then "Accra Prime Realty is submitted for review… Your logo is saved."
   - **Database:**
     - `MarketplaceProfessional` is `PENDING`, with the reference in `verificationEvidenceReferences`.
     - `logoUrl` is the second image.
     - The `WhatsAppFlowDraft` is `SUBMITTED`.
     - It appears in the Super Admin professionals queue.
   - **Cleanup:** none.
9. **Listing before approval.** B sends `list a property`, answers through photos (1 photo), `done`, then **Confirm**.
   - **WhatsApp:** "Accra Prime Realty isn't approved by NesAfric yet… Your listing is saved as a draft."
   - **Database:** `Listing` stays `DRAFT`, and the draft returns to review.
   - **Cleanup:** keep it; it is reused in step 11.
10. **Super Admin approval.** A verifies Accra Prime Realty in the platform admin.
    - **WhatsApp:** a decision notice **only if** `WHATSAPP_TEMPLATE_NOTIFICATION` names an approved template. Today no template exists, so expect no WhatsApp message.
    - **Database:** `verificationStatus` is `VERIFIED`; the email job is queued as today; no `decision:` WhatsApp message without the template.
    - **Cleanup:** none.
11. **10-photo enforcement, removal and cover.** B sends `resume`, then photos 2 to 10, then an 11th photo, then `remove 2`, a new photo, `cover 3`, `photos`, `done`, and **Confirm**.
    - **WhatsApp:**
      - "Photo n of 10 added." for each photo up to 10.
      - For the 11th: "This listing already has 10 photos, so that one wasn't added…".
      - "Photo 2 removed. 9 of 10 left.", "Photo 10 of 10 added.", "Photo 3 is now the cover."
      - The review shows "Photos: 10 of 10, cover: photo 1." (the chosen cover moves to the front).
      - Then "Submitted for review".
    - **Database:**
      - `Listing` is `PENDING_REVIEW` with exactly 10 `PHOTO` rows and exactly one cover.
      - Every `sourceMediaId` is unique.
      - Nothing is `PUBLISHED`.
    - **Cleanup:** none.
12. **Stale confirmation.** B starts a second listing (`list a property`) and answers through to the review. A then edits that listing's title on the website. B taps **Confirm**.
    - **WhatsApp:** "The listing changed after you reviewed it… Reply done to review the current version." Then `done` gives "changed somewhere else… Reply reload". Then `reload` gives "Loaded the latest version".
    - **Database:** `Listing` stays `DRAFT` until B confirms the re-reviewed version.
    - **Cleanup:** none.
13. **Image with no active draft.** B sends `menu` (which leaves the flow) and then a photo, while the second listing's draft is still open at its photo step.
    - **WhatsApp:** "I didn't save that image because it isn't clear which draft it belongs to…"
    - **Database:** no new `ListingMedia`.
    - **Cleanup:** none.

**Window 3: provider registration and service publication** (relink B to a fresh fixture account first: `--business` with a new account, or another phone)

14. **Provider registration.** B sends `register services`, `1`, `Kwame Plumbing Services`, `skip`, `1`, `Tema`, a description, `1, 2`, `Tema, Ashaiman`, `1`, `BN-778899`, `skip`, then **Confirm**.
    - **WhatsApp:** "Kwame Plumbing Services is submitted for review".
    - **Database:** `ServiceProvider` is `PENDING` with `contactReady` set, 2 categories, 2 areas and one evidence item (BUSINESS_REGISTRATION).
    - **Cleanup:** none.
15. **Service listing before approval.** B sends `list my services`, `1`, `1`, `Tema`, a description, `2`, `150`, `1`, two images, `done`, then **Confirm**.
    - **WhatsApp:** "…goes live once NesAfric approves Kwame Plumbing Services".
    - **Database:**
      - `ProviderMarketplaceProfile.listed` is false, `pricingModel` STARTING_FROM, `startingRateMinor` 15000.
      - Two `ProviderPortfolioImage` rows.
    - **Cleanup:** none.
16. **Approval, then publication.** A approves the provider. B repeats step 15 and confirms.
    - **WhatsApp:** "Your service listing is published."
    - **Database:** `listed` is true; the provider appears on the public marketplace.
    - **Cleanup:** none.

**After the last window:** see Cleanup below. Everything was created in the throwaway database `nesafric_live_rc_test`, so dropping it removes every test record.

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
