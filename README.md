# PropertyOS AI

PropertyOS AI is a Ghana-first, multi-tenant property operating system foundation. Phase 1 deliberately implements only identity, organisation access control, country/currency configuration, portfolios, property assets, audit events, and basic operations UI.

## Architecture

The application is a TypeScript modular monolith built with Next.js and PostgreSQL/Prisma. `src/modules` owns business domains; `src/platform` owns cross-cutting concerns. Domain services enforce permissions and organisation scoping; routes are thin authenticated adapters.

`Property` is an asset, separate from its `PropertyOwner` and its `managingOrganisation`. Buildings are optional; units can belong to a property directly or to a building. Listing, lease, payment, tenant, maintenance, and finance domains are intentionally absent.

## Setup

1. Copy `.env.example` to `.env` and set `DATABASE_URL` and `SESSION_SECRET`.
2. Run `npm install`.
3. Run `npm run db:generate && npm run db:deploy && npm run db:seed`.
4. Run `npm run dev`.
5. (Optional) Grant platform-administration access with `npm run platform-admin:bootstrap -- <email> SUPER_ADMIN`, or set `PLATFORM_ADMIN_BOOTSTRAP_EMAILS` before starting the app. This is independent of organisation membership — see `docs/architecture.md`.

## Demo environment (development only)

`npm run db:seed` only seeds foundational reference data (country/currency/permissions/roles/plans) —
it creates no organisations, properties, or users. To populate a local database with a realistic,
fully-connected demo organisation for manual/visual inspection of the product:

1. Make sure PostgreSQL is running locally, e.g. `brew services start postgresql@16` (adjust for
   your installed version/OS).
2. Apply migrations: `npm run db:generate && npm run db:deploy`.
3. Seed foundational reference data: `npm run db:seed`.
4. Seed the demo organisation: `npm run seed:demo`.
5. Promote the demo platform-admin account (a separate, explicit, operator-run step — the same one
   a real platform administrator would use, never exposed through any HTTP endpoint):
   `npm run platform-admin:bootstrap -- platform-admin@propertyos.demo SUPER_ADMIN`.
6. Run `npm run dev` and sign in at `http://localhost:3000/login`.

Demo logins (all share the password `DemoPassword123!`):

| Role | Email |
| --- | --- |
| Landlord / organisation owner | `landlord@propertyos.demo` |
| Property manager (staff) | `manager@propertyos.demo` |
| NesAfric platform administrator (after step 5) | `platform-admin@propertyos.demo` |

**These are development/demo credentials only and must never be used against, or exist in, a
production environment.** `npm run seed:demo` refuses to run when `NODE_ENV=production`; every
demo user's email uses the non-production `@propertyos.demo` domain, and every demo display
name/organisation name is suffixed "(Demo)" so seeded records are unmistakable in any list view or
audit log. The script only ever creates records — it never deletes or modifies pre-existing data —
and is safe to rerun: if the demo organisation already exists, it exits as a no-op instead of
creating duplicates.

## Database and security

Migrations are committed under `prisma/migrations`; production uses `npm run db:deploy`, never `db push`. Monetary values must use integer minor units plus an ISO-4217 currency code when financial domains are added. Timestamps are stored in UTC.

Every organisation-owned lookup is scoped by the active organisation and every mutation calls `requirePermission`. Audit records are append-only from application APIs. Domain events use a database outbox table for future consumers.

## Validation

Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`.

## Future module boundaries

Future listings reference `Property` or `Unit`; they do not extend the asset table. Payments, leases, tenants, maintenance, providers, and AI tools must use domain services and typed events rather than direct database access.
