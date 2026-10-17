# NesAfric WhatsApp assistant

NesAfric's own WhatsApp Business number becomes a conversational front door to the existing
platform. Customers find properties and service professionals; agents, agencies, developers,
landlords and service providers register and submit listings — all through the **existing**
NesAfric services and tables. WhatsApp only adds a transport and resumable conversation state.

> This is separate from the per-organisation tenant inbox (`/api/webhooks/whatsapp/[organisationId]`,
> `src/modules/conversations`), which is unchanged.

## How the blueprint maps onto the existing platform

| Blueprint component | Where it lives |
| --- | --- |
| WhatsApp integration layer | `src/modules/whatsapp-assistant/cloud-api.ts` (Cloud API parse/send/media/signature), `ingest.ts`, route `src/app/api/webhooks/whatsapp-assistant/route.ts` |
| Conversation orchestrator | `engine.ts` (commands, menu, intent routing, pause/resume), `nlu.ts` (deterministic understanding), `ai.ts` (optional AI via the existing `AI_PROVIDER`) |
| Workflow engine | `workflows/*.ts`, `form.ts` (guided, resumable forms), `state.ts` (durable session state) |
| Users & identity | Existing `User`. `WhatsAppContact.userId` links a number to an account (`identity.ts`) |
| Agencies, agents, developers, landlords | Existing `MarketplaceProfessional` + `MarketplaceProfessionalMember` (`createMarketplaceProfessional`, `submitMarketplaceVerification`) |
| Service providers | Existing `ServiceProvider`, `ProviderMarketplaceProfile`, `ProviderEvidence` (`createServiceProvider`, `uploadProviderEvidenceDocument`, `submitProviderVerification`) |
| Property listings & drafts | Existing `Listing` + `MarketplaceAsset` (`createMarketplaceNativeListing`, `updateMarketplaceNativeListing`, `submitMarketplaceListingForReview`) |
| Media | Existing upload pipeline (`uploadMarketplaceListingMedia`: content sniffing, size limits, malware scan, durable storage, single-cover rule) |
| Search | Existing `searchPublicListings` (+ new `area` and `furnishing` filters, also usable by the website) and `discoverMarketplaceProviders` |
| Inquiries, viewings, quotes | Existing `createMarketplaceLead`, `createViewingRequest`, `createMarketplaceEnquiry` |
| Moderation | Existing platform-admin queues and decisions (`verifyAndPublishListingForPlatform`, `requestListingChangesForPlatform`, `rejectListingForPlatform`, `reviewMarketplaceVerification`, `reviewProviderIdentity`) — now also notify on WhatsApp (`notifications.ts`) |
| Jobs | Existing `BackgroundJob` runner (`whatsapp-assistant-inbound`, `whatsapp-assistant-outbound` handlers) |
| Admin dashboard | New `/platform-admin/whatsapp` page inside the existing platform-admin shell |

New tables (migration `20261017120000_whatsapp_assistant`) hold only transport and workflow state:
`WhatsAppContact`, `WhatsAppInboundMessage`, `WhatsAppOutboundMessage`, `WhatsAppAssistantSession`,
`WhatsAppAction`, `WhatsAppSupportRequest`, `WhatsAppAssistantEvent`. Three nullable
`sourceChannel` columns (`Listing`, `MarketplaceProfessional`, `ServiceProvider`) record that a
record was created on WhatsApp ("Submission source: WhatsApp" for reviewers). There is no second
property database.

## What people can do

Main menu (also reachable by just typing naturally — "2 bedroom apartment in East Legon", "I need a plumber in Spintex"):

1. **Find a property** — rent/buy, type, area (Ghanaian regions, cities and neighbourhoods are recognised; anything else is kept as free text), budget ("4k", "2 million", "between 3k and 5k"), bedrooms, furnishing. Results are only verified, published, available listings, three at a time with photo, price, location, verification label, reference and the real public URL. Zero results are reported honestly with options to broaden; a technical failure is never shown as "no results".
2. **Ask about a property / request a viewing** — common questions are answered from the listing's own record ("parking isn't listed, so I can't confirm it"); the question is sent to the agent as a lead. Viewing requests are always "requested, not confirmed" until the agent confirms; the customer is messaged when they do.
3. **Find a service provider** — category from everyday words ("my sink is leaking" → Plumbing Repairs), area, job details. Ratings appear only when real ratings exist. Quote requests go only to verified providers accepting work, through the existing enquiry service.
4. **Register a real-estate business** — agency/brokerage, marketing company, developer, property management, independent agent, landlord. Creates a `MarketplaceProfessional` and puts it in the verification queue (`PENDING`). An agent naming an agency gains nothing: the agency's admins are told and must add them to their team.
5. **Register a service business / professional** — creates a `ServiceProvider` with an *unlisted* public profile, stores the Ghana Card privately (`PRIVATE` storage), submits verification, optional logo. The profile is listed automatically only after a platform reviewer approves the provider's identity.
6. **List a property** — requires an active membership of a business profile (otherwise the person is offered registration). Category-aware questions (no bedrooms for land; land size for land; per-night for short stays), authority + proof description, then an AI-assisted title/description **built only from what was said** and confirmed by the person, then the draft is saved and photos are collected (main photo first = cover, up to 12). Review summary → *Submit for review*. Nothing is public until a platform reviewer approves.
7. **Check status** — the person's own businesses, providers, listings (with the reviewer's note when changes were requested), inquiries, viewings, quote requests and support requests. Listings can be fixed and resubmitted, paused for editing, marked rented/sold or withdrawn.
8. **Talk to support** — creates a `WhatsAppSupportRequest` for the admin dashboard, noting (not exposing) what the person was doing.

Universal commands: `menu` (pauses an unfinished registration/listing), `resume`, `cancel`, `status`, `support`, `help`, `stop`/`start` (notification opt-out/in). Typed numbers ("2") or option titles select the options just offered.

## Reliability design

- **Webhook**: signature verified with `WHATSAPP_APP_SECRET` before parsing (fail closed when unset); every message is stored once (unique Meta message id), then acknowledged. Processing runs right after the response (`after()`) and a durable `BackgroundJob` (60 s later) re-runs anything missed.
- **Ordering & isolation**: a per-contact lease (`WhatsAppAssistantSession.lockedUntil`) processes one person's messages strictly in order; different people never share state.
- **Atomic steps**: for each message the new session state, the queued replies and the PROCESSED mark commit in one transaction — a crash causes a clean re-run.
- **At-most-once business actions** (`actions.ts`): creating a listing/registration/lead/viewing/enquiry is keyed by the triggering message. A repeat returns the stored result; an interrupted run is never blindly retried — the person is told it's being checked and support is alerted.
- **Outbound**: idempotent rows, sent in order; retryable failures back off via jobs without re-running the conversation step; delivery statuses (sent/delivered/read/failed) are applied monotonically.
- **24-hour rule**: replies are free-form; proactive notifications outside the 24-hour window use `WHATSAPP_STATUS_TEMPLATE_NAME` or are recorded as SKIPPED with the reason. Opted-out contacts get no notifications.
- **Failures**: three failed attempts on a message → the person gets an honest apology with a support reference, progress is kept, and a support request is opened.
- **AI unavailable**: everything works with the deterministic parser; AI (if configured) only classifies unclear messages and polishes listing copy, behind timeouts, with schema validation and a faithfulness check (no new numbers, no legal/verification claims).

## Security model

- WhatsApp proves possession of the sender's number, so a linked account uses that number as its verified phone — the same proof as the website's SMS code. It grants nothing else: every marketplace/provider/organisation action still goes through the domain services' own permission checks, and platform-admin access exists only via `PlatformPrincipal` (never touched here). Admin decisions are never available on WhatsApp.
- Messages, captions and documents are untrusted data. Prompt text can't select tools: the model has none that read or write data.
- Listings are reachable for editing only through the person's own active memberships; other agencies' listings are invisible (tested).
- Private documents (Ghana Card, business registration) are stored `PRIVATE`; WhatsApp's temporary media URLs are used once and never stored.
- Admin views mask phone numbers and never list message bodies. Support replies need the `whatsapp_support.manage` platform permission (SUPER_ADMIN, SUPPORT_AGENT) and are audited.
- Abuse limit: more than `WHATSAPP_INBOUND_RATE_LIMIT_PER_MINUTE` (default 60) messages per contact per minute are stored but not processed.

## Setup

1. Apply the migration: `npm run db:deploy`.
2. Meta Business: create an app with the WhatsApp product, add NesAfric's phone number, create a System User with a permanent token (`whatsapp_business_messaging`, `whatsapp_business_management`).
3. Set the `WHATSAPP_*` variables (see `.env.example`), with `WHATSAPP_ASSISTANT_ENABLED="true"`.
4. In Meta → WhatsApp → Configuration, set the callback URL to `https://<domain>/api/webhooks/whatsapp-assistant` and the verify token to `WHATSAPP_WEBHOOK_VERIFY_TOKEN`; subscribe to the `messages` field.
5. Create and get approval for a **utility** template with one body variable (`{{1}}`), e.g. "NesAfric update: {{1}}", and set `WHATSAPP_STATUS_TEMPLATE_NAME`.
6. Make sure background jobs run: the Vercel cron already calls `/api/jobs/run` every 5 minutes; for faster retries run `npm run worker`.
7. Optional: `AI_PROVIDER` / `AI_PROVIDER_API_KEY` enable AI assistance. `WHATSAPP_ASSISTANT_AI="off"` turns it off.
8. Platform admins see activity, support requests and failures at `/platform-admin/whatsapp`; WhatsApp submissions are reviewed in the existing Verification, Real Estate Professionals and Providers queues.

## Tests

- `tests/whatsapp-assistant-nlu.unit.test.ts` — intents, criteria, money/area/date parsing, categories, references, copy faithfulness, Cloud API parsing/signatures, interactive limits.
- `tests/postgres-whatsapp-assistant.integration.test.ts` — customer search, zero results, inquiry + viewing, duplicate webhooks.
- `tests/postgres-whatsapp-business.integration.test.ts` — agent/agency registration, listing with photos, corrections + resubmission + publication with URL, cross-agent isolation, pause/resume, affiliation claims.
- `tests/postgres-whatsapp-services-security.integration.test.ts` — service search + quote, provider registration with private ID and post-approval listing, forged/replayed webhooks, fail-closed secret, outbound retry without duplicates, prompt injection, 24-hour/opt-out rules, "never claim live", isolation, support + admin permissions, safe cancel.

All Meta traffic is faked (`tests/helpers/whatsapp-assistant.ts`); no real messages are sent.

## Known limitations

- Not yet verified against a live Meta number: production readiness needs the external setup above and a manual end-to-end check. No load testing has been done; no throughput figure is claimed.
- Agency/landlord verification uses evidence **references** (registration number, declared authority), matching the platform's current professional-verification policy; documents for real-estate businesses are requested by the review team if needed. Service providers upload documents.
- Listing photos only (no video) on WhatsApp; up to 12 per listing, as on the website.
- A company service provider gets a regular organisation (as the website's onboarding requires), which starts its standard trial subscription.
- Approved service providers still choose "accepting work" in their dashboard before customers can send them quote requests (existing platform rule).
- Amenity answers in inquiries are keyword-based; anything not on the listing is passed to the agent rather than guessed.
- Pre-existing, unrelated: `prisma migrate diff` reports drift on `BusinessWhatsAppConfig` (UUID columns in the migration vs TEXT in the schema) on a freshly replayed database; this change does not touch it.
