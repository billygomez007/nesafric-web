# Mobile: role-aware Account and workspaces

The app stays marketplace-first. It always opens on Home, and no role screen appears at start-up. People who manage property on NesAfric reach their workspace from the Account tab.

## Account tab
**Signed out:**
- **Looking for property?** Browsing, saving and contacting listers work without an account. **Sign in or create account** opens sign-in.
- **MANAGE ON NESAFRIC**: three full-width cards, each with an icon, one line, a chevron, a button role, a label and a hint:
  - Landlord & Property Manager
  - Real Estate Professional
  - Service Provider
- Tapping a card opens sign-in with that *intent*:
  - It only changes wording and what is highlighted after sign-in.
  - It lives in memory only, is never stored and never sent anywhere, and grants nothing.

**Signed in:**
- profile;
- if the person tapped a card: a notice.
  - If the server lists a workspace of that kind: **Open …**.
  - Otherwise: "This account doesn't have a … workspace yet", with the matching offer highlighted;
- **Current workspace:**
  - **Continue in …**, shown only if the last workspace is still in the server's list;
  - **Switch workspace**;
- **Your homes** (unchanged);
- **Your workspaces:** Marketplace first, then every workspace the server lists;
- **Grow on NesAfric:** only the kinds the account doesn't have yet. Each opens the website, and the list is refreshed on return.
  - Set up Property Management: `/onboarding`
  - Register as a Real Estate Professional: `/pro/new`
  - Register as a Service Provider: `/onboarding`
- **Sign out.**

## Where access comes from
- **`resolveAvailableWorkspaces(session)`** (`mobile/src/workspace/resolve.ts`):
  - Marketplace, plus exactly the items in the server's `/api/workspaces` response for the signed-in user.
  - Signed out, restoring, or not loaded yet: Marketplace only.
- **`resolveInitialWorkspace(session, lastActiveWorkspace)`:**
  - Returns the remembered `{kind, id}` only if it exactly matches an available workspace; otherwise Marketplace.
  - Used for "Continue in …", never for launch routing.
- **`lastActiveWorkspace`:**
  - Stored in AsyncStorage as `nesafric.last-workspace.v2:<userId>` → `{kind, id}`.
  - It is navigation state: it never adds a workspace.
  - Unlisted or corrupt values are removed. The v1 value (a bare organisation id) is migrated.
  - Every `nesafric.last-workspace.*` key is removed on sign-out or session loss.
- **Workspace gate:** every workspace screen passes through `useWorkspaceGate` first.
  - An id not in the server's list shows "Workspace not available", and no request for it is sent.
  - Each request is then re-checked by the server: organisation membership and permissions, professional membership, or provider ownership.
- **Cache:** workspace data is cached under `["account", userId, "ws", "org:…" | "pro:…" | "prv:…", …]`.
  - Opening a workspace drops the others' cached data.
  - Sign-out drops all account data.
- **Narrow data:** responses are copied into narrow shapes. Tenant contact details, internal notes and provider contact details are never kept.

## Workspaces
Every workspace has a header with **Account** (back) and **Switch**. Its **More** tab has Switch workspace, **Switch to Marketplace**, and Manage on nesafric.com.

| Workspace | Route | Tabs | Server data |
|---|---|---|---|
| Property management | `/workspace/:organisationId` | Dashboard, Properties, Tenants, Maintenance, More | `/api/dashboard`, `/api/maintenance/dashboard`, `/api/properties`, `/api/tenants`, `/api/maintenance/requests`, and the existing inbox (`x-organisation-id`) |
| Real estate professional | `/agent/:professionalId` | Dashboard, Listings, Leads, More | `/api/marketplace-professionals/:id/{dashboard,listings}`; Leads is the existing agent inbox |
| Service provider | `/provider/:providerId` | Dashboard, Jobs, More | `/api/providers/:id`, `/metrics`, `/jobs` (owner access, no organisation header) |

- **Denied tab:** a tab the role can't read (403) says "Your role here doesn't include …", and the other tabs keep working.
- **Existing routes:** the inbox, enquiry and viewing routes keep their URLs.

## Backend
- `/api/workspaces` now includes `serviceProviders`; see `docs/workspaces-service-providers.md`.
- The app treats a missing key as "none". Against an API without this change, the Service Provider workspace simply doesn't appear.

## Not available on mobile yet (no API change made; reported, not invented)
- **Provider side:**
  - accepting or declining a job (`POST /api/provider-assignments/:id/response` exists; the app is read-only for now);
  - sending quotations (`/api/provider-quotations/*` exists; not built);
  - editing the provider profile or verification.
  - There is no provider-wide list of open quotation requests: `GET /api/provider-quotations/requests` needs one landlord organisation (`x-organisation-id`) at a time, so the app can't show a provider all the quotes waiting for them.
- **Property management:** writing anything (leases, rent, assigning maintenance, replying to enquiries). All of it stays on the website.
- **Professional:** creating or editing listings, replying to leads, team, promotions.
- **Push notifications** for any workspace (no device-token API).
- **Onboarding:** the web page has no deep link to a specific onboarding choice. `/onboarding` asks again, so Service Provider and Property Management land on the same chooser.
- **Web sign-in:** the in-app browser uses a separate web session, so onboarding asks the person to sign in on the website.

## Tests
- `mobile/src/__tests__/resolve.test.ts`: resolution, intent parsing, and the last-workspace store (tamper, migration, sign-out).
- `mobile/src/__tests__/workspaces.test.tsx`: signed out, customer, property manager, professional, provider, multi-role, security (intent, tampering, foreign deep links, shared device, no credentials on public routes).
- The existing account, inbox, tenant, home, saved and marketplace suites run unchanged, apart from the new signed-out wording.
