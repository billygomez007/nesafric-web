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

## Database and security

Migrations are committed under `prisma/migrations`; production uses `npm run db:deploy`, never `db push`. Monetary values must use integer minor units plus an ISO-4217 currency code when financial domains are added. Timestamps are stored in UTC.

Every organisation-owned lookup is scoped by the active organisation and every mutation calls `requirePermission`. Audit records are append-only from application APIs. Domain events use a database outbox table for future consumers.

## Validation

Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`.

## Future module boundaries

Future listings reference `Property` or `Unit`; they do not extend the asset table. Payments, leases, tenants, maintenance, providers, and AI tools must use domain services and typed events rather than direct database access.
