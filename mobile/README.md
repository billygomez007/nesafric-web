# NesAfric mobile (Android + iOS)

One Expo / React Native codebase for both platforms. Phase 1A is the **signed-out public
marketplace**: the app opens straight into property discovery, with no login.

Product direction: `docs/mobile-product-direction.md` (locked brief) — marketplace is the front
door; professional workspaces come later behind one NesAfric identity.

## What's in Phase 1A

| Tab / screen | What it does | Backend |
| --- | --- | --- |
| Home | "Find your perfect property", search, intent + type chips, collections (Newly listed, For rent, For sale, Popular in Accra, Land, Commercial). Empty collections are hidden — no placeholder data. | `GET /api/public/listings` |
| Search | Keyword search + filters the API supports: rent/buy, type, city, price range (GH₵), min beds/baths. Infinite scroll. | `GET /api/public/listings` |
| Property details | Photo gallery, price, facts, description, amenities, listed-by, approximate location, **Contact agent** / **Schedule viewing**. | `GET /api/public/listings/:id` |
| Contact / viewing | Guest form (no account): name + phone or email, required consent to share details with the lister, optional follow-up consent, up to 3 viewing windows. | `POST /api/public/listings/:id/leads`, then `/viewings` |
| Saved | Hearted properties, stored **on this device only** (AsyncStorage). | none |
| Account | Optional sign-in (Phase 1B). Signed out: sign-in, "create an account" (opens the web registration page), support, privacy, terms. Signed in: real profile, the workspaces the server lists, sign out (immediate on the device; server revocation in the background, reported honestly — see `docs/mobile-auth.md`). | `POST /api/auth/mobile/session`, `GET /api/account/profile`, `GET /api/workspaces`, `POST /api/auth/logout` |
| Workspace overview | Read-only summary of a property-management workspace the user belongs to (properties, units, team members); the server enforces membership and `property.read`. Professional profiles open on the website. | `GET /api/dashboard` with `x-organisation-id` |
| Enquiries & viewings | Read-only inbox inside a workspace: sections shown only when the server allows them, paged lists, details, Call / Email for usable contact details. See `../docs/mobile-workspace-inbox.md`. | `GET /api/marketplace-leads[/:id]`, `GET /api/viewing-requests[/:id]` with `x-organisation-id` |

Deliberately **not** included yet:

- **Map tab** — deferred until a real interactive map ships (needs a Google Maps key for Android).
- **Password reset, Google sign-in, service-provider workspaces and management screens** — no
  backend flow yet or later phases; kept out of navigation. See `../docs/mobile-auth.md`.
- Filters the API can't answer (furnished, new developments, amenities, availability, geo-bounds)
  and collections that need new backend support (Featured, Near You, New Developments).

## Setup

```bash
cd mobile
npm ci
cp .env.example .env    # then set EXPO_PUBLIC_API_URL
```

`EXPO_PUBLIC_API_URL` is **required** and has no default: a build without it shows an "App not
configured" screen instead of silently talking to an unverified or production backend. Use
`https://…`; plain `http://` is allowed only for `localhost` / `10.0.2.2` (Android emulator → your
machine) during development. The staging URL mentioned in the web repo's cron workflow has not been
verified — confirm any URL before using it.

## Commands

| Command | What it checks |
| --- | --- |
| `npm run typecheck` | TypeScript |
| `npm run lint` | ESLint (`eslint-config-expo`) |
| `npm test` | Jest: formatting, filters, enquiry validation, API client, token drift vs `src/app/globals.css`, and screen flows via `expo-router/testing-library` |
| `npm run export:android` / `export:ios` | Full Metro + Hermes JavaScript bundle for each platform |
| `npm start` | Dev server (Expo Go / dev build) |

CI: `.github/workflows/mobile-ci.yml` runs all of the above on changes to `mobile/**`.

## Verified in the Linux cloud environment

- Typecheck, lint, Jest (unit + screen tests), Android and iOS Hermes bundles.
- Web preview (`expo export --platform web`) against a local NesAfric backend with seeded demo
  listings, driven by Playwright at 390×844: home, search, filters, details, save, guest viewing
  request (validation → consent → confirmation), saved, account. This proves layout and API wiring,
  **not** native behaviour.

## Still to check on a Mac / real devices

The cloud environment has no Android SDK, emulator, Xcode or EAS access. Before any store build:

1. **iOS Simulator** (Xcode): `npx expo run:ios` — safe areas / notch, modal enquiry sheet,
   keyboard avoidance on the form, fonts, tab bar labels, pull-to-refresh, image caching.
2. **Android emulator + a low-end physical device** (2–3 GB RAM) on throttled 3G:
   `npx expo run:android` with `EXPO_PUBLIC_API_URL=http://10.0.2.2:3000` for a local backend.
   Check scroll performance of image lists, back button behaviour, keyboard, text scaling.
3. **Accessibility**: VoiceOver / TalkBack labels on cards, save buttons, chips, checkboxes.
4. **Real data**: listing photos come from the API; confirm image sizes are reasonable for mobile
   data (the API has no resized variants yet).
5. **EAS builds** (`eas.json` has `preview` APK and `production` profiles; both require
   `EXPO_PUBLIC_API_URL` to be set first) — needs an Expo account, Apple Developer and Google Play
   accounts.

The bundle identifier / package `com.nesafric.app` is **provisional** — confirm before the first
store build, as it can't be changed after publishing.

## Structure

```
src/app/               Expo Router screens: (tabs)/index|search|saved|account, listing/[id]/index|enquire,
                       sign-in, workspace/[organisationId]/index|inbox|enquiry/[leadId]|viewing/[viewingId]
src/api/               API client (public + opt-in bearer auth), marketplace & account endpoints, React Query hooks
src/auth/              Session provider, secure token storage (expo-secure-store), workspace memory
src/workspace/         Inbox UI pieces, workspace gate, contact-detail checks
src/marketplace/       Pure logic: price/facts formatting, search filters, enquiry validation, local saves
src/components/        UI kit (buttons, fields, cards, chips, checkbox) in NesAfric tokens
src/theme/tokens.ts    Mirrors src/app/globals.css (test fails on drift)
```
