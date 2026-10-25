# NesAfric WhatsApp Flows

Twelve WhatsApp Flows on the official number (+233 50 282 0002, WABA `1104581892174096`). Each one is a **data_exchange** Flow: every screen's choices come from NesAfric's endpoint, and every submission goes back to it and is checked again before anything is written. The Flows are an alternative way in; the chat conversations work as before.

Code: `src/modules/whatsapp-flows/` (definitions, endpoint, handlers, completion), route `src/app/api/webhooks/whatsapp/flows/route.ts`, script `scripts/whatsapp-flows.ts`.

## How a Flow runs

1. **Sent.** `forms` in the chat lists the configured Flows; `form 3` opens one. A property search hands over to Book a viewing or Property inquiry for the chosen listing. Each message carries a new **flow_token** (`token.ts`): signed with a key derived from `SESSION_SECRET`, valid 24 hours, and binding the Flow, the WhatsApp number it was sent to, the official organisation and any context (the listing). Meta sends no phone number in data exchange, so the token is the only identity.
2. **Data exchange** (`endpoint.ts`), in this order:
   - Meta's `X-Hub-Signature-256` with `WHATSAPP_APP_SECRET`. A bad signature gets 432.
   - RSA-OAEP-SHA256 key unwrap and AES-128-GCM decryption with `WHATSAPP_FLOWS_PRIVATE_KEY`. A failure gets 421, which makes WhatsApp fetch the current public key.
   - The flow_token, which must be for the official organisation. A bad token gets 427.
   - The Flow's handler (`handlers.ts`), which re-checks the account link, listing, tenancy and permissions on every request.
   - The response, encrypted with the flipped IV. A health check (`ping`) answers `{status: "active"}`.
3. **Finished.** A submission that writes something ends with the `SUCCESS` response. Its outcome is signed (`signOutcome`), and the WhatsApp client returns it in the inbound `nfm_reply`. `completion.ts` acts only on an outcome NesAfric signed for a token issued to that same number: it replies with the reference, sets the chat state, sends the next Flow, or hands over to support.

Logs: `whatsapp.flows.exchange`, `.completed`, `.token_rejected`, `.client_error` and `.error`. Each has the Flow, action, screen, duration and a hash of the token nonce. Form contents and phone numbers are never logged.

## Flow-to-backend mapping

| Flow | Meta id | Screens | Server actions | Writes (through the existing domain services) |
|---|---|---|---|---|
| `nesafric_property_search` | 1656146049308321 | SEARCH → RESULTS / NO_RESULTS → DETAILS → (Book / Ask) | `searchPublicListings` (published only, GHS, region, type, budget, bedrooms); `getPublicListing` for every id the screen sends back | None. Hands the chosen listing to Book a viewing or Property inquiry |
| `nesafric_book_viewing` | 947132434820601 | BOOK | Listing from the token only. Dates from tomorrow to 60 days ahead. Hourly slots 08:00–17:00 Ghana time, minus slots overlapping a CONFIRMED or RESCHEDULED viewing of that listing, and less than 2 hours ahead. Availability is re-checked at submission. One open request per number per listing (a second one returns the first) | Lead and viewing request (`submitCustomerRequest`, idempotency key from the token nonce). Status REQUESTED: the agent confirms |
| `nesafric_property_inquiry` | 1421839692827883 | INQUIRY | Listing from the token only | Lead with the question |
| `nesafric_list_property` | 4464855953767350 | NOTICE / BASICS → PRICING → AUTHORITY | Linked account, then its businesses (agency, agent or landlord organisation). Every answer goes through the chat listing step's own validator (`prefillGuided`) | DRAFT listing (`syncListing`, as in the chat). The chat continues with photos, review and submission to NesAfric review |
| `nesafric_agent_registration` | 3211270599241040 | NOTICE / PROFILE | Linked account. Duplicate-business check. The chat registration steps validate | Registration draft. The chat continues with the certificate (agency) or the Ghana Card front and back (agent), the logo and the review |
| `nesafric_landlord_registration` | 1671682967750311 | NOTICE / SETUP | Linked account. Units parsed as in the chat | Onboarding draft with the first property and its units. The chat continues (more properties, tenants, invitations) |
| `nesafric_tenant_registration` | 935408099445570 | NOTICE / CONNECT | Linked account | `redeemTenantAccessCode` (the landlord's NT- code) |
| `nesafric_maintenance_request` | 2393058591440552 | NOTICE / REPORT | The account's tenancies (`listUserTenancies` for repairs). The maintenance service re-checks the tenancy | Maintenance request (intake WHATSAPP, idempotent reference), routed to that landlord |
| `nesafric_find_professional` | 1983289999015531 | SEARCH → RESULTS / NO_RESULTS → DONE | Verified, unsuspended providers only | None. The profile link is where quotes are requested |
| `nesafric_book_service` | 1112835894967070 | REQUEST | Active service categories, dates in the next 60 days | Hand-off to the support queue with the request summary |
| `nesafric_property_management` | 2095003597775156 | NOTICE / MENU | The account's landlord organisations and their counts | None. The chosen task runs as the same chat command (`account`, `register`, `list a property`, `providers`) |
| `nesafric_help_support` | 1513182454191456 | HELP | Topic and message | Hand-off to the support queue (`HUMAN_REQUIRED`) |

Untrusted input is never used as is: listing and provider ids are looked up as public records again, option ids are matched against the server's own lists, and the account comes from the number's verified link (`linkedWhatsAppUser`), never from the form.

## Environment variables

| Variable | Purpose |
|---|---|
| `WHATSAPP_FLOWS_PRIVATE_KEY` | RSA private key (PEM) whose public key is registered on the phone number. Secret Manager |
| `WHATSAPP_FLOWS_PRIVATE_KEY_PASSPHRASE` | Optional |
| `WHATSAPP_APP_SECRET` | Meta app secret (already used by the webhook) |
| `WHATSAPP_FLOW_IDS` | JSON `{ "nesafric_property_search": "1656146049308321", … }` (the registry) |
| `WHATSAPP_FLOWS_MODE` | `draft` (default: Flows can be sent before they are published) or `published` |
| `WHATSAPP_OFFICIAL_ORGANISATION_ID`, `SESSION_SECRET` | Already required |

## Tests

- `tests/whatsapp-flows.unit.test.ts`:
  - Structural validation of all 12 Flow JSON files: routing, terminal screens, every `${data.*}` and `${form.*}` reference, and option sources.
  - Tokens and signed outcomes.
  - The endpoint: health check, and the 432, 421, 427 and 503 answers.
  - The Flow message payload, and `nfm_reply` parsing.
- `tests/postgres-whatsapp-flows.integration.test.ts`: every Flow end to end through the encrypted endpoint against PostgreSQL. Covered:
  - Search to booking hand-off.
  - Slot conflicts and duplicate viewings.
  - Unpublished listings.
  - Inquiry.
  - Agent listing to a DRAFT listing at the photos step.
  - Agent registration to the Ghana Card step.
  - Landlord sign-up to the onboarding.
  - Tenant code and repair report routed to the landlord.
  - Portfolio menu.
  - Verified-only professionals.
  - Support hand-off.
  - Tampered and foreign outcomes refused.
  - The `forms` menu.

## Deployment steps (each needs explicit approval)

1. **Key pair.** Generate an RSA-2048 key pair. Store the private key as the secret `WHATSAPP_FLOWS_PRIVATE_KEY`. Register the public key on the phone number: `POST /1304923409378538/whatsapp_business_encryption` with `business_public_key`.
2. **Cloud Run settings.** Add `WHATSAPP_FLOW_IDS` and `WHATSAPP_FLOWS_MODE=draft` to the service, and mount the key secret.
3. **Deploy** this branch (Cloud Build) and check that `/api/webhooks/whatsapp/flows` answers Meta's health check.
4. **Upload and point the Flows.** With `NESAFRIC_META_TOKEN` and `NESAFRIC_WABA_ID` exported, run `npx tsx scripts/whatsapp-flows.ts upload --confirm-waba 1104581892174096 --registry ~/nesafric-whatsapp-templates/flows/nesafric_flow_registry.json`, then `endpoint …`, then `status …`. Fix any validation errors and repeat.
5. **Test.** Test each Flow from a real phone in draft mode (`forms`).
6. **Publish.** Publish in WhatsApp Manager only after approval. Then set `WHATSAPP_FLOWS_MODE=published`.
