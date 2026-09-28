# Advertising carousel, listing price units and mobile portfolio operations

Written for: NesAfric engineers and Super Admin operators. Behaviour as of 2026-09-27.

## Advertising carousel

### Placements

| Placement value | Where it renders | Super Admin label |
| --- | --- | --- |
| `MARKETPLACE_PRIMARY` | Homepage advertising carousel on nesafric.com **and** the native app home screen | Homepage Advertising Carousel (web + app) |
| `MARKETPLACE_INLINE` | Carousel at the top of the property search page (web) | Property Search Carousel |
| `HOMEPAGE_ANNOUNCEMENT` | Text-only announcement bar (web) | Homepage Announcement Bar |
| `PROFESSIONAL_FEATURED` | Professional directory banner (web) | Professional Directory |
| `DEVELOPMENT_FEATURED`, `SEARCH_FEATURED` | Not rendered publicly yet | … (not yet public) |

Root cause of "campaign created but not in the carousel": the Super Admin form labelled
`MARKETPLACE_INLINE` as "Marketplace Primary Carousel" and made it the default, while the homepage and
the app request `MARKETPLACE_PRIMARY` (which was labelled "Property Services Marketplace"). Campaigns
created for "the carousel" were saved to the property-search placement. The labels are corrected, the
default is now `MARKETPLACE_PRIMARY`, and Super Admin can change the placement of an existing
platform-owned campaign (audited as `platform_admin.campaign_edited` with `placement.from/to`).

### Eligibility (one rule set)

`GET /api/public/campaigns?placement=…&countryCode=GH&limit=…` (response `cache-control: no-store`)
returns a campaign only when all hold:

- status is `APPROVED`, `SCHEDULED` or `ACTIVE` and `archivedAt` is empty;
- `startAt` is empty or has passed, and `endAt` is empty or has not passed;
- it is untargeted or targeted at the viewer country (both web and app send `GH`);
- an advertised service provider is `VERIFIED` and not suspended;
- an advertising marketplace professional is `ACTIVE` and not archived.

Ordered by `priority` (desc), then newest. The SQL lives in `eligibleCampaignWhere`
(`src/modules/campaigns/service.ts`); `campaignEligibility` (`src/modules/campaigns/eligibility.ts`)
evaluates the same rules for one campaign so Super Admin sees "Showing in …" or
"Not currently showing: <reason>" (Draft, Waiting for approval, Rejected, Paused, Ended, Archived,
Starts <date>, Expired, Targeted at XX only, provider/advertiser problems, placement not public yet).

Web and app never re-implement eligibility; they render what the API returns.

### Publishing

- **Save Draft** → `DRAFT` (never public).
- **Publish Now** → `APPROVED` (no dates, public at once) or `SCHEDULED` (any date set, public only
  inside the window). A draft is published with `POST /api/platform-admin/campaigns/:id/publish`.
- Pause / End / Archive remove the campaign from the next request.
- Self-service (advertiser) campaigns still require `PENDING_APPROVAL` → platform review; nothing
  here bypasses that.

### No campaign

The carousel is **campaigns only**. With no eligible campaign, or when the request fails, the web
homepage renders nothing in the slot (no frame) and the app hides the carousel. Property listings and
the old "List your property on NesAfric" slide are never used as substitutes.

### Creative selection

Upload canvases: desktop web 1600×220, mobile web 800×320, native app **1200×480 (2.5:1)**.

| Surface | Uses |
| --- | --- |
| Desktop web | desktop creative |
| Mobile web | mobile creative, else desktop |
| Native app | native creative, else mobile web, else desktop |

A campaign with no artwork is skipped: it is never drawn as a text slide. With no campaign that has
artwork, the carousel is hidden. Super Admin shows a creative note when a surface falls back
(`creativeReadiness`).

Artwork is the whole ad. Nothing is drawn over it: no Sponsored/Promoted badge, headline, copy, CTA,
gradient or tint. It is always shown uncropped and undistorted (`object-contain` on web,
`contentFit="contain"` in the app).

### Native carousel size (from 2026-09-28)

The app card keeps its width (screen minus 16 pt gutters, max 560 pt) and is now 2.5:1:
`cardHeight = cardWidth × 0.4` (was `min(cardWidth × 0.66, 320)`). On a 402 pt iPhone that is
370 × 148 pt instead of 370 × 244 pt, about 61% of the old height.

**Legacy 1200×792 native uploads** still work and need no re-upload to stay safe: they are drawn with
`contentFit="contain"` inside the 2.5:1 card, so they show whole and centred with plain side margins
in the page surface colour (`#f8f5ef`). They are never cropped, stretched or put on a dark
NesAfric-made backdrop. For a full-bleed card, upload a new 1200×480 native creative.

### Rotation

Both the website and the app advance the Homepage Advertising Carousel (`MARKETPLACE_PRIMARY`)
automatically. Super Admin → Campaigns → **Carousel rotation** sets 5, 8 or 10 seconds for the whole
placement (default 5; table `CampaignPlacementSetting`, migration
`20260928190000_campaign_placement_rotation`; a missing row means 5 seconds).
`GET /api/public/campaigns?limit=…` returns it as `rotationSeconds`.

Autoplay never runs for a single campaign, keeps one timer per shown slide, pauses while a finger is
on the carousel (app) or while hovered/focused (web), stops when Home is not visible or the app is in
the background, and respects reduced motion. The app has no arrow buttons: people swipe, and the dots
show position. Impressions are still counted once per campaign per session, when it is shown.

## Listing price units

`Listing.frequency` (API field name kept) uses the listing-only enum `ListingPriceUnit`:
`DAILY`, `MONTHLY`, `QUARTERLY`, `ANNUAL`, `PER_SQM`, `PER_KM`, `CUSTOM`. Leases and rent schedules
keep `RentFrequency` unchanged. Migration `20260927120000_listing_price_units` converts the column
in place (existing values are unchanged) and updates `Listing_type_price_check`:

- rental: a unit is required (any value);
- sale: no unit (total price) or `PER_SQM` / `PER_KM`; never a rent period.

Labels: Per day, Per month, Per quarter, Per year, Per square metre (m²), Per kilometre (km),
Custom terms. Display suffixes: `/day`, `/month`, `/quarter`, `/year`, `/m²`, `/km` (none for custom
or a total sale price), e.g. "GH₵1,200/m²". Area stays separate ("750 m²"). Shared definitions:
`src/lib/price-units.ts` (web) and `mobile/src/marketplace/price-units.ts` (app).

Converting an application to a lease inherits the listing unit only when it is a rent period; for
`DAILY`, `PER_SQM` or `PER_KM` the lease frequency must be chosen explicitly
(`LEASE_RENT_FREQUENCY_REQUIRED`).

## Mobile portfolio operations

All flows call the existing web API with the session bearer token; the server re-checks membership,
role permission, organisation scope and listing ownership on every call.

- **Real estate professional** — Listings tab → Add listing (`POST /api/marketplace-professionals/:id/listings`),
  edit a draft/returned/paused listing (`PUT …/listings/:listingId/details`), photos from the device
  library (`POST …/media`, JPEG/PNG/WebP ≤ 3 MB, set cover, remove), Submit for review with an
  optional evidence reference (`POST …/submit`). Listings in review are read-only; published ones open
  their public page.
- **Landlord / property manager** — Properties tab → Add property (`POST /api/properties`), property
  detail → Edit property (`PATCH /api/properties?id=`), Add unit (`POST /api/properties/:id/units`),
  Edit unit (new `PATCH /api/properties/:id/units/:unitId`, audited `unit.updated`). Tenants tab →
  Add tenant (`POST /api/tenants`), optionally placed in a property/unit of the same workspace through
  a **draft** lease (`POST /api/leases`), tenant detail → edit details (`PATCH /api/tenants/:id`) and
  Place in a property.

Not included: tenant app-access invitations. The invitation/access-code architecture is not on this
base yet, so the app does not offer an "Invite tenant" action.
