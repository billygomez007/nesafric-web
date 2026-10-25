# NesAfric master feature inventory (Phase 1 audit)

Audit date: 22 October 2026. Read-only. Nothing was created, deleted, merged, pushed or deployed.

Status keys: **IMPLEMENTED** (code on `main`), **PARTIAL**, **MISSING**, **TESTED** (automated tests exist and last passed), **STAGING-DEPLOYED**, **PRODUCTION-DEPLOYED**. "Unmerged" means the code exists only on a branch.

---

## 1. Headline findings (blocking)

| # | Finding | Evidence | Impact |
|---|---|---|---|
| B1 | **Production and staging websites are offline.** Vercel returns `402 DEPLOYMENT_DISABLED` for `nesafric.com`, `www.nesafric.com`, `nesafric-web.vercel.app` and `nesafric-web-staging.vercel.app`. | `curl -I` → `x-vercel-error: DEPLOYMENT_DISABLED` | No feature is currently PRODUCTION-DEPLOYED or STAGING-DEPLOYED in a usable sense. The mobile app (`EXPO_PUBLIC_API_URL=https://www.nesafric.com`) has no backend. |
| B2 | **Every Google Cloud billing account visible to `info@realtegicworks.com` is closed** (5 of 5, `OPEN=False`). | `gcloud billing accounts list` | No billable Google Cloud resource (Cloud Run, Cloud SQL, Secret Manager, Artifact Registry) can be provisioned until a billing account is reopened or added. |
| B3 | **GCP project `nesafric` is suspended** (`CONSUMER_SUSPENDED`). Its Cloud SQL instance `nesafric-prod-db` (PostgreSQL 18, `db-custom-2-7680`, europe-west2-c, 20 GB, backups on, created 23 Sep 2026) is `SUSPENDED` with reason `BILLING_ISSUE`. | `gcloud sql instances describe` | Contents unknown. It must be treated as possibly holding production data. Do not delete. |
| B4 | **The NesAfric WABA is wired to the Tap & Order Meta app.** The token in `.env.local` is a `SYSTEM_USER` token of the app "Tap & Order", with business-wide (untargeted) WhatsApp scopes. The NesAfric WABA's subscribed apps are "Business Agent" and "Tap & Order". | Graph API `debug_token`, `/{waba}/subscribed_apps` (read-only) | Violates the isolation rule ("Do not use Tap & Order credentials"). NesAfric webhooks currently route to the Tap & Order app's callback URL. A NesAfric-owned Meta app and system user are required before cutover. |
| B5 | **Production database (Neon, `us-east-1`, PostgreSQL 18.6, 24 MB) is behind `main`.** Table `WhatsAppNumberAssignment` (migration `20261018230000`) does not exist. | Read-only query | PRs #37 and #38 (merged 18 Oct) never reached production. Further production reads were blocked by the session's permission policy, so the exact migration head and row counts are not recorded here. |
| B6 | **GitHub Actions runs fail at startup** on `main` and on the WhatsApp branch since 21 Oct ("likely failed because of a workflow file issue"). | `gh run list` | Gate 2 (automated testing) cannot be evidenced in CI. Likely an Actions billing/spending limit on the private repo, or a workflow syntax problem; needs checking in GitHub settings. |

Other notable facts:

- Current hosting: **Vercel** (Next.js 16, project `nesafric-web`), **Neon** Postgres, **S3-compatible** object storage, DNS on **Cloudflare**. A GCS adapter exists in code (`src/platform/storage/gcs-adapter.ts`) but is not in use.
- The backend **is** the Next.js app (386 route files under `src/app/api`). There is no separate API service. "Backend on Cloud Run" therefore means running this Next.js app (plus `npm run worker`) on Cloud Run.
- GCP project `nesafric-ac521` (Firebase) has a `db-f1-micro` Cloud SQL instance `nesafric-web-fdc` running on the Firebase Data Connect free trial (label `firebase-data-connect=ft`, created 4 Oct 2026). The untracked `dataconnect/`, `firebase.json`, `.firebaserc` in the repo belong to it. The application does not use it.
- GCP project `realtegic-nesafric-386174` ("NesAfric Google Services") holds Search Console, Tag Manager, Play publisher and Analytics admin APIs. No compute.
- Tap & Order runs in `kora-os-47f9f` / `kora-os-project`. Not touched.

## 2. Git inventory

- 190+ local branches, ~60 worktrees (including stale `prunable` ones in old Claude scratchpads). All preserved.
- `origin/main` head: `69e839d` (PR #41, 19 Oct 2026).
- Current checkout: `chore/local-whatsapp-test` (`8da164f`), with **uncommitted changes** to `src/components/campaign-creative.tsx` and `tests/campaign-creative.unit.test.tsx`. Left untouched.

### Unmerged work that matters

All WhatsApp branches form one linear stack. The tip contains everything below it.

| Branch | Ahead of main | Pushed | Contents |
|---|---|---|---|
| `claude/vibrant-cray-ei6kmy` = `feature/whatsapp-utility-phase1` (`81b2b1b`) | 17 | yes | **Tip.** Utility templates U01–U30, registry, Meta state machine, dispatch; includes everything below. 97 files, +8.3k lines. Suite reported 1363/1363 passing locally on 21 Oct. |
| `release/whatsapp-business-rc` (`8ee4d4c`) | 13 | no | Business registration, property/service listings and photos over WhatsApp, storage-key hardening. |
| `feat/whatsapp-business-onboarding-listings` | 8 | no | Subset of the above. |
| `candidate/whatsapp-launch-check` | 7 | no | Next 16.4.2 security upgrade, tappable menus, landlord onboarding fix. |
| `fix/next-16.4.2-security-upgrade` (`19f9fda`) | 1 | no | **Critical RCE advisory fix**, unmerged to main. |
| `feat/geographic-locations` (`f6e0168`) | 15 (3 own) | no | WIP: Ghana regions/districts schema, importer, resolver, search filters. Forks from the RC stack. |
| `fix/lease-update-schema-defaults` (`9aefcbb`) | 1 | no | Partial update schemas no longer inject defaults. |
| `chore/local-whatsapp-test` (`8da164f`) | 2 | via tip | Inbound allowlist, live-test safeguards. |

Open PRs: #2 (Google auth + GCS), #8/#9/#10/#14 (mobile, drafts), #24 (security hardening batch 1), #36 (WhatsApp assistant draft, superseded by the stack above).

## 3. Feature inventory

### 3.1 Marketplace and web

| Feature | Status | Notes |
|---|---|---|
| Property marketplace (search, listing cards, detail, gallery) | IMPLEMENTED, TESTED | Web + mobile. Offline (B1). |
| Listing review / publication workflow | IMPLEMENTED, TESTED | `ListingStatusHistory`, `ListingVerificationEvidence`. |
| Listing photos, cover photo | IMPLEMENTED, TESTED | |
| Viewing requests (web) | IMPLEMENTED, TESTED | `ViewingRequest`, preferred times, status history. No slot-availability model: requests are preferences, not booked slots. |
| Enquiries / leads | IMPLEMENTED, TESTED | `MarketplaceLead`, `MarketplaceEnquiry`, guest rate limits (PR #8 still draft). |
| Saved properties | IMPLEMENTED (mobile) | |
| Agency / professional profiles | IMPLEMENTED | `MarketplaceProfessional`. |
| Service-provider marketplace, quotations, work orders | IMPLEMENTED, TESTED | PRs #27–#35. |
| Campaigns, homepage media, top ads | IMPLEMENTED | |
| Ghana geography (region/district/neighbourhood) | PARTIAL, unmerged WIP | `feat/geographic-locations`. |
| SEO / GTM | IMPLEMENTED | `nesafric-web-gtm` worktree; analytics ids in env. |

### 3.2 Accounts, workspaces, auth

| Feature | Status | Notes |
|---|---|---|
| Email/password, passwordless OTP (Arkesel SMS) | IMPLEMENTED, TESTED | |
| Google sign-in | PARTIAL | PR #2 open since 23 Sep. |
| Role-aware workspaces (owner, admin, property manager, viewer, technician) | IMPLEMENTED, TESTED | Seeded roles and permissions. |
| Organisation invitations (staff) | IMPLEMENTED (web) | Not over WhatsApp. |
| Platform admin, support sessions, audit | IMPLEMENTED, TESTED | |
| Account deletion (Play policy) | IMPLEMENTED | PR #26. |
| Security hardening batch 1 | PARTIAL | PR #24 open. |

### 3.3 Property management

| Feature | Status | Notes |
|---|---|---|
| Portfolios, properties, buildings, units | IMPLEMENTED, TESTED | |
| Tenants, tenant access invitations, OTP verification before activation | IMPLEMENTED, TESTED | `TenantAccessInvitation`; rule preserved. |
| Leases, amendments, e-signature, lease documents | IMPLEMENTED, TESTED | |
| Rent obligations, recurring charges, payments, receipts, deposits, ledger | IMPLEMENTED, TESTED | |
| Reminders | IMPLEMENTED | `ReminderPolicy`. |
| Maintenance requests, routing, dispatch, approvals, work orders | IMPLEMENTED, TESTED | PR #37/#41. |
| Move-in / move-out / vacancy turnover | IMPLEMENTED | |
| Rental applications | IMPLEMENTED | |
| AI employees / autonomy policies | IMPLEMENTED | |

### 3.4 WhatsApp

Source: `docs/whatsapp-utility-phase1-completion.md` on the tip branch, plus this audit.

| Feature | Status | Branch |
|---|---|---|
| Webhook with `X-Hub-Signature-256`, idempotent inbound, quarantine on number moves | IMPLEMENTED, TESTED | main |
| Platform-only number assignment, official number | IMPLEMENTED, TESTED | main |
| Durable outbox (`MessageDelivery`, `BackgroundJob`), retries, STOP handling | IMPLEMENTED, TESTED | main |
| Welcome menu as tappable list + reply buttons | IMPLEMENTED, TESTED | unmerged |
| Property search (rent/buy, area, budget, category, paginated 3 at a time) | PARTIAL | main + unmerged; no photos sent, no bedroom/furnished filters |
| Viewing request by seeker | PARTIAL | seeker must type ISO timestamp; no slot availability; agent cannot confirm/move/cancel in WhatsApp |
| Agency, agent, service-provider registration | PARTIAL | unmerged; needs existing web account |
| Listing creation with up to 10 photos, cover, drafts, admin review | PARTIAL | unmerged; cannot edit after submission |
| Landlord / property-manager onboarding (properties, units, tenants) | IMPLEMENTED, TESTED | main |
| Tenant OTP link + access-code redemption | PARTIAL | landlord cannot issue invitation from WhatsApp |
| Tenant "my home" details | PARTIAL | no rent, payments, receipts, lease doc |
| Maintenance report by tenant (text + media), routing, provider dispatch | IMPLEMENTED, TESTED | main |
| Utility templates U01–U30 | PARTIAL | unmerged; 16 FINAL, 14 NEEDS_REVIEW; **none submitted to Meta** |
| Role-aware workspace menus (agency / landlord / PM / tenant) | MISSING | |
| Agency staff invitation over WhatsApp | MISSING | web only |
| Rent/payment records, reminders and reports over WhatsApp | MISSING | |
| Ghana Card upload over WhatsApp | MISSING | blocked on malware scanner (finding S7) |
| Referrals, rewards | MISSING | |
| Live Meta verification | NOT DONE | B4 |

### 3.5 Identity verification

| Feature | Status | Notes |
|---|---|---|
| Ghana Card front/back as provider evidence, platform review | IMPLEMENTED (service providers, web) | `ProviderEvidence` types `GHANA_CARD_FRONT/BACK`, consent model, verification history. |
| Ghana Card for agencies, landlords, agents | MISSING | Agents only give a typed reference. |
| Country-configurable identity framework | MISSING | |
| Malware scanning of uploads | PARTIAL | Adapter exists; no provider configured. |

### 3.6 Subscriptions and payments

| Feature | Status | Notes |
|---|---|---|
| Organisation plans: Starter GHS 250, Growth GHS 750, Scale GHS 2,000 per month | IMPLEMENTED | `prisma/seed.ts`. These are the NesAfric prices; Tap & Order prices must not be used. |
| Marketplace plans: Free GHS 0, Pro GHS 150, Brokerage GHS 600, Enterprise GHS 1,500 per month | IMPLEMENTED | |
| Free trial | IMPLEMENTED as **14 days** on Starter | `src/modules/subscriptions/lifecycle.ts`. The request asks for one month: **needs approval** before changing. |
| Payment providers (MTN MoMo, Telecel Cash, AT Money, card, bank transfer) | PARTIAL | Adapters and env keys exist; live verification unknown. |
| Escrow, split payments | Not present | Correct; out of scope without approval. |

### 3.7 Mobile (Expo, `mobile/`, bundle `com.nesafric.app`)

Routes exist for marketplace tabs, listing detail/book/enquire, agent workspace (leads, listings, viewings, inbox), landlord workspace (properties, units, tenants, maintenance, inbox), tenant home and reports, provider jobs, service marketplace, Google sign-in, workspace switcher. Several PRs remain draft (#9, #10, #14). Not store-released by this audit.

## 4. Decisions and approvals needed before Phase 2+

1. **Billing**: reopen or add a Google Cloud billing account for NesAfric (B2). Decide what to do with suspended `nesafric` / `nesafric-prod-db` (B3): restore billing to inspect it, or confirm it holds nothing.
2. **Vercel**: the site is down now (B1). Either restore the Vercel plan as a stop-gap or accept downtime until Cloud Run is live.
3. **Project layout**: create new `nesafric-production` + `nesafric-staging`, or reuse the existing (suspended) `nesafric` project.
4. **Database**: keep Neon (no data migration, move only compute) or migrate to Cloud SQL.
5. **Meta**: create a NesAfric-owned Meta app and system user scoped only to the NesAfric WABA (B4).
6. **Trial length**: 14 days (current code) vs one month (request).
7. **Merge plan** for the unmerged WhatsApp stack and the Next.js security fix.
8. **GitHub Actions**: fix CI start-up failure (B6).
