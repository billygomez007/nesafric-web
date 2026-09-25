# Design Phase 1 — baseline (before changes)

Captured 25 Sep 2026 on `design/phase-1-visual-foundation`, cut from `origin/main` at `9f7f3b6`.
Headless Chromium at 375, 768 and 1440 px against `next dev` with the local database.

**Scope of what could be rendered.** The local database had no users or listings and one
unapplied migration (`20260924182000_organisation_branding_logo`), so signed-in screens could not
be captured with real data. Public and marketing pages were captured directly; `/dashboard` renders
its non-production development fallback; marketplace and listing screens were reviewed with a
browser-side mock of the public listings API (nothing written to the database).

## Measured

| Check | Result |
|---|---|
| Horizontal overflow (all routes, all widths) | none |
| Broken image responses | none |
| Heading / body font actually rendered | Noto Sans (from the PDF font files), registered as `--font-montserrat`, weights 400/700 only |
| `font-semibold` usages (weight 600 not loaded → synthesised) | 1,437 |
| `rounded-xl` / `2xl` / `3xl` / `full` usages | 880 / 262 / 62 / 212 |
| `shadow-card` usages (utility undefined → no effect) | 118 |
| Raw `slate-*` colour utilities | 438 |
| Uppercase tracked eyebrow labels | 236 |
| `loading.tsx` / `error.tsx` route files | 0 / 0 |

## Observed

- `/for-property-owners`, `/for-professionals`, `/for-developers`, `/ghana` displayed AI-generated
  mockup images branded **UmoAfric — Everything Property** (dark UI, 👋 greetings, Lagos listings
  priced in GHS, garbled figures).
- Homepage: pill eyebrow + 5rem headline + 32px-rounded photo with two frosted "Live operations /
  Connected" cards; five consecutive eyebrow → headline → paragraph sections; final CTA immediately
  followed by a second CTA band in the footer.
- Marketplace pages had no site navigation (their own wrapping text links on mobile), a 16-field
  filter wall including "Country (e.g. GH)" and free-text currency, raw enum labels
  (`RENT · PROPERTY`, `VERIFIED`) on cards.
- Listing detail showed "Geocoding/map integration ready", "This creates a marketplace lead, not a
  tenant record.", a "PHOTO" tag on every image, only 4 photos, and a "Send request" button with
  dark ink text on forest (~1.5:1).
- Dashboard: time-of-day greeting, icon-tile metrics, a "Portfolio mix" donut with **fixed**
  46/21/17/16% slices, a search box and bell with no behaviour, and a hard-coded "N" avatar.
- Platform admin: 19 ungrouped links rendered in full above content on mobile; active link white
  on teal (~3.4:1).
- Ghana marketplace section showed an unlabelled company ("Accra Realty Partners · 14 active
  listings").
- Gold text on light surfaces (`text-gold`) measured 2.56:1.

## Tests on untouched `origin/main`

Pre-existing unit-test failures (not caused by design work): `analytics-core` (sendGAEvent with a
measurement ID) and the theme-contrast guard "never fades a disabled control via opacity alone"
(offenders: `onboarding-form.tsx`, `platform-admin/health/page.tsx`, `marketplace-listing-form.tsx`).
