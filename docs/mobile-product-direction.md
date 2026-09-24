# NesAfric Mobile — Locked Product Direction

Status: **Locked** (2026-09-24). This is the agreed direction for the NesAfric mobile app, to be
treated as fixed before detailed screen design and implementation begin. Changes to anything in
§1 need an explicit decision recorded here.

> NesAfric is a marketplace-first real-estate platform where anyone can discover properties
> without signing in, while landlords, property managers, registered real-estate professionals
> and service providers can access dedicated operating workspaces through a single NesAfric
> identity.

The marketplace is the front door. The professional workspaces are the operating system behind
it. Shared identity, property, payments, messaging, documents, verification and permissions
infrastructure connects them.

---

## 1. Locked decisions

| # | Decision | Rule |
| --- | --- | --- |
| D1 | Marketplace is the home screen | Opening the app never shows a login screen. Browse, search, map and property details work signed-out. |
| D2 | Auth only on intent | Sign-in is requested only for an account-specific action (sync saves, schedule viewing, enquire, apply) or to enter a workspace. |
| D3 | One identity | One `User` per person. Never separate landlord/agent/provider accounts or auth systems. |
| D4 | Identity → Workspace → Role → Permissions | Authentication (who), workspace (where), authorization (what) stay separate layers. Code asks "what may this member do in this workspace", never "is this user an agent". |
| D5 | Many workspaces per person | One account can hold Personal + any number of landlord, professional and provider workspaces. |
| D6 | Switch, don't log out | Permanent **Switch Workspace**. Last-used workspace is remembered. One workspace → open it directly; several → "Continue as". |
| D7 | Sign-in choice is a context hint | "How are you using NesAfric?" selects the workspace to open or onboard into. It never locks the person's identity to a category. |
| D8 | Professional status is earned | Choosing Professional or Service Provider starts onboarding + verification. It grants no verified status on its own. Requirements are per-country. |
| D9 | Four experiences, one app | Marketplace/Customer, Landlord & Property Management, Registered Property Professional, Service Provider. Internal admin is not a customer-facing workspace. |
| D10 | Connected, not separate apps | Shared design system, notifications, messaging, documents, search, payments, profile, security, verification. |

## 2. Experiences and navigation

| Experience | Bottom navigation | Core scope |
| --- | --- | --- |
| Marketplace (signed-out / Personal) | Home · Search · Map · Saved · Account | Discovery, property details, saves, viewings, enquiries, applications, offers, payments, documents. Tenant features (My Home, Lease, Rent, Receipts, Maintenance Requests) appear when the person becomes a tenant — same account. |
| Landlord / Property Manager | Overview · Properties · Tenants · Maintenance · More | Portfolio value, monthly rent, occupancy, outstanding rent; properties, buildings, units, tenants, leases, rent, payments, deposits, maintenance, inspections, documents, messages, team, reports. |
| Registered Property Professional | Dashboard · Listings · Leads · Viewings · More | Listings, leads, clients, enquiries, viewings, applications, deals, follow-ups, developments, marketing, team, performance. |
| Service Provider | Jobs · Schedule · Messages · Earnings · More | Job requests, active jobs, quotations, schedule, customers, service areas, earnings, payments, reviews, business profile, verification, team. Technicians get a restricted view. |

### Marketplace specifics

- **Home:** "Find your perfect property" + search/location. Intent chips: Buy · Rent · New
  Developments · Land · Commercial. Type chips: Houses · Apartments · Land · Commercial · Short Stay.
  Collections: Featured, Near You, For Rent, For Sale, Newly Listed, Verified, New Developments,
  Land, Commercial, Popular in {city}.
- **Search filters:** buy/rent, location, type, price range, beds, baths, furnished, new
  development, land, commercial, amenities, verified, availability.
- **Map:** price-pill markers (`GH₵8.5K`, `GH₵850K`); tap reveals the property.
- **Saved:** local saves when signed-out; cross-device sync requires an account.
- **Account:** also an icon top-right. Offers Sign In / Create Account.
- **Property card:** photo, price, title, location, beds · baths · m², verified badge, save.
  Nothing operational.
- **Property details:** image-led hero → price, title, location, verification → key facts →
  description, amenities, gallery, video, virtual tour, floor plans, map, neighbourhood, nearby
  facilities, professional, viewing availability, similar properties. Persistent primary actions:
  **Schedule Viewing**, **Contact Agent** (later: Apply, Make Enquiry, Request Financing).

### Opening journey

```
Open app → Marketplace → browse/search/map/details
  → Account → Sign In / Create Account
  → "How are you using NesAfric?" (Personal · Landlord/PM · Professional · Service Provider)
  → Authenticate → resolve memberships + permissions
  → one match: open it | several: Choose Workspace | none for chosen type: onboarding
  → Switch Workspace any time, no sign-out
```

## 3. Role catalogues per workspace type

| Workspace type | Roles |
| --- | --- |
| Property management | OWNER, ADMIN, PROPERTY_MANAGER, ACCOUNTANT, MAINTENANCE_MANAGER, VIEWER |
| Brokerage / professional | OWNER, ADMIN, BROKER, SALES_MANAGER, AGENT, MARKETING, VIEWER |
| Service company | OWNER, ADMIN, DISPATCHER, TECHNICIAN, FINANCE, VIEWER |

UI visibility is driven by permissions, not role names, so custom roles can be added later.

## 4. The loop that makes it a platform

```
PM workspace ─publish→ Marketplace ─enquiry→ Professional/PM workspace ─lead/viewing→
Application → Lease → Deposit → Tenant account → Rent · Maintenance · Documents
Maintenance request → Work order → Provider marketplace → Quote → Approval → Job →
Evidence → Payment → Review → History on the property
```

Rental lifecycle: create property → units → publish → discovery → enquiry → viewing →
application → approval → lease → deposit → move-in → rent → maintenance → renewal → move-out →
deposit settlement → re-list.

## 5. Visual direction

Warm white backgrounds, charcoal type, NesAfric gold accent, large architectural photography,
rounded cards, subtle shadows, generous spacing. Image-first, premium, fast, trustworthy. No
neon-green property-app clichés. Workspaces may be denser than the marketplace but not busier.
Reference: `design/reference/nesafric-approved-reference.png`, `.21st/DESIGN.md`.

---

## 6. Fit against the current codebase

The web platform already implements most of the backend this direction needs. The main work is
unifying what exists, not building from scratch.

| Brief requirement | Current state | Gap |
| --- | --- | --- |
| One identity (D3) | ✅ Single `User`; email/password + Google (`src/modules/identity`, `src/app/api/auth`). | No phone/OTP sign-in. No Apple sign-in. `User.passwordHash` is required. |
| Identity → Workspace → Role → Permission (D4) | ⚠️ Three parallel membership systems: `OrganisationMember` + `Role`/`Permission` (PM orgs); `MarketplaceProfessionalMember` with its own `OWNER/ADMIN/AGENT` enum; `ServiceProvider.individualUserId` / `administratorUserId` / `companyOrganisationId`. `PlatformPrincipal` is correctly separate. | Converge on one workspace-resolution and permission-check path. `MarketplaceProfessional` already has a `backingOrganisationId` and members are mirrored as `OrganisationMember`s, so the route is to make `Organisation` + `OrganisationMember` + permissions the single authority for all three workspace types. |
| Role catalogues per type (§3) | ⚠️ `Role.key` is global. Seeded: `organisation_owner`, `administrator`, `property_manager`, `viewer`, `technician`. | Add a workspace-type scope to roles; seed ACCOUNTANT, MAINTENANCE_MANAGER, BROKER, SALES_MANAGER, MARKETING, DISPATCHER, FINANCE. |
| Workspace list + switching (D5, D6) | ⚠️ `GET /api/workspaces` returns PM orgs and professional profiles only. Active org lives in browser `localStorage` (`propertyos.activeOrganisationId`) and is sent as `x-organisation-id`; server re-validates membership. | Include provider workspaces and a synthetic Personal workspace. Store last-used workspace server-side (per user, per device) so mobile and web agree. |
| Marketplace signed-out (D1) | ✅ `/marketplace/properties`, `/marketplace/properties/[listingId]`, `/api/public/listings`, public media. | Web root `/` is a B2B marketing page, not the marketplace. Mobile needs a versioned public listing API with filter, geo-bounds (map) and collection endpoints. |
| Saved properties | ❌ No model. | Add `SavedListing` (user-scoped) + a merge endpoint for device-local saves on sign-in. |
| Viewings / enquiries / applications | ✅ `ViewingRequest`, `MarketplaceLead`, `RentalApplication`, `Applicant`. | Customer-side "my viewings/enquiries/applications" views keyed on `User`, not on org. |
| Tenant account | ⚠️ `TenantOrganisation.userId` is optional; tenant data is org-scoped. | A tenant-facing read model: "my leases/rent/receipts/requests across all landlords" for a `User`. |
| Professional verification (D8) | ✅ `MarketplaceProfessional.verificationStatus` + events; `ServiceProvider` Ghana Card identity/business/credential gates. | Unify into one per-country verification requirement model used by both. |
| Provider marketplace loop (§4) | ✅ `MaintenanceRequest` → `WorkOrder` → `ProviderQuotationRequest` → `ProviderQuotation` → `ProviderAssignment` → `ProviderRating`. | Provider-side mobile job flow (accept, schedule, photo evidence, completion) and provider earnings/payout. |
| Mobile auth transport | ⚠️ Cookie `Session` for web. | Token-based sessions for native clients (short-lived access + rotating refresh), bound to device. |

## 7. Risks and challenges to the brief

These don't reopen the decisions above. They are things the brief underplays that will decide
whether the app works in Ghana.

1. **Email/password is the wrong default for this market.** Most target users live on phone
   numbers and WhatsApp. Phone + OTP must be a first-class sign-in, and phone must be able to be
   the only identifier. Budget for SMS OTP cost and fraud (SIM-swap, OTP pumping). Rate-limit per
   number and per device.
2. **"How are you using NesAfric?" before auth adds friction for returning users.** Ask it only
   at account creation or when the resolved memberships don't match the request. A returning
   user should go straight to their last workspace.
3. **The marketplace is only as good as its supply and trust.** Signed-out browsing is worthless
   if listings are stale, duplicated or fake. Lead with verified listings, show "last confirmed
   available" dates, and make fake-listing reporting one tap. Trust is the product in this market.
4. **"Contact Agent" will leak off-platform to WhatsApp.** Don't fight it — make NesAfric the
   system of record: WhatsApp click-to-chat with a tracked lead, so professionals still see value
   in the leads inbox and NesAfric can measure conversion.
5. **Four workspaces is a lot of surface for v1.** Ship order should follow revenue:
   Marketplace + Professional (listings → leads, the supply side) first, then Landlord/PM
   (subscription revenue, already strongest on web), then Tenant, then Service Provider.
6. **Bandwidth and devices.** Image-first design must degrade: responsive image sizes, low-data
   mode, cached last results, and offline read of saved properties. Test on low-end Android over
   3G, not flagship iPhones on Wi-Fi.
7. **Currency and price display.** Rentals in Ghana are often quoted in USD and paid in advance
   (e.g. 1–2 years). Cards need currency-aware display and an "advance required" fact, or the
   price shown will mislead.
8. **Map is expensive and often imprecise.** Many listings will have approximate locations
   (`ListingLocationPrecision` already exists). Show areas, not fake pins, for approximate
   locations.

## 8. Build sequence

1. **Foundations (no mobile UI yet)** — unified workspace resolver across PM orgs, professionals
   and providers, plus Personal; server-side last-used workspace; token auth for native clients;
   phone + OTP sign-in; per-type role catalogues.
2. **Public marketplace API v1** — search/filter, geo-bounds query for the map, curated
   collections, listing detail; `SavedListing` + local-save merge.
3. **Mobile shell + Marketplace** — Home, Search, Map, Saved, Account, property details,
   Schedule Viewing / Contact Agent (tracked WhatsApp).
4. **Professional workspace** — Listings, Leads, Viewings.
5. **Landlord / PM workspace** — Overview, Properties, Tenants, Maintenance.
6. **Tenant features in Personal** — My Home, Rent, Receipts, Maintenance Requests.
7. **Service Provider workspace** — Jobs, Schedule, Messages, Earnings.

Each step should ship with the permission checks and audit trail patterns already used in
`src/modules` (`requirePermission`, organisation scoping, `AuditEvent`).
