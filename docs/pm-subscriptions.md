# Property-management subscriptions, trial and entitlements

Only landlords and property managers who **activate property management** need a plan. Agents,
brokers, sellers, buyers, tenants and anyone who only lists or searches the marketplace stay free.

## Where things live

| Concern | File |
| --- | --- |
| Plans, prices, unit/staff/branch capacity, features, allowances, trial and dunning timings (single source of truth) | `src/modules/subscriptions/plan-catalog.ts` |
| Plan rows in the database (generated from the catalog) | `prisma/migrations/20261027090100_pm_subscription_plans/migration.sql`, regenerate with `npx tsx scripts/generators/pm-plans-migration-sql.ts` |
| Activation (the trial starts here), one trial per organisation and per person | `src/modules/subscriptions/activation.ts` |
| Entitlement service: management gate, features, allowances, unit capacity under lock | `src/modules/entitlements/service.ts` |
| Central gate for property-management permissions | `MANAGEMENT_PERMISSIONS` in `src/platform/authorization/permissions.ts` |
| Checkout (hosted payment) and webhook-only activation | `src/modules/subscriptions/checkout.ts` |
| Lifecycle sweep (reminders, expiry, renewal, grace) and the billing webhook | `src/modules/subscriptions/lifecycle.ts` |
| Owner notices (in-app + email copy) | `src/modules/subscriptions/notices.ts` |
| Billing page / dashboard banner / public pricing | `src/components/billing-settings.tsx`, `plan-status-banner.tsx`, `marketing/pricing-experience.tsx` |

The database rows are what is enforced at runtime, so a platform admin can change a price or limit
without a deploy (Platform admin → Plans). Changing the catalog file requires regenerating the
migration block (a unit test fails if the two drift) and a new migration for already-deployed
databases.

## Rules

- **Activation** happens on the first property-management operation: the first managed unit (web
  or WhatsApp onboarding), the first tenant, lease, rent schedule, provider assignment and the
  other permissions in `MANAGEMENT_PERMISSIONS`, or the "Start free trial" button. Creating an
  account, an organisation, a property with no units (a listing source), a listing, or inviting a
  marketplace teammate never activates it.
- **Trial**: 30 days from activation, on the hidden `pm_trial` plan (Growth operations, Essential
  capacity, smaller allowances, no Enterprise extras). One trial per organisation and per person:
  owner and activating user's id, email and verified phone are stored as SHA-256 hashes in
  `ManagementTrialIdentity`; a match starts the subscription as `EXPIRED` (paid plan required).
- **Reminders** at 7, 3 and 1 days before the trial ends, each once, only while still trialing.
- **No automatic charge**: a trial ends in `EXPIRED` unless a checkout payment was confirmed.
  A paid plan renews automatically only if the provider holds a recurring authorisation
  (`billingSubscriptionRef` issued by the provider); otherwise renewal is a checkout.
- **Statuses**: `TRIALING`, `ACTIVE`, `PAYMENT_PENDING`, `PAST_DUE` → (3 days) `GRACE_PERIOD` →
  (7 days) `EXPIRED`, `CANCELLED` (at period end by default), `SUSPENDED` (platform only; resuming
  restores the previous status, never a paid one nobody paid for).
- **When not entitled** (`EXPIRED`, `PAYMENT_PENDING`, `CANCELLED`, `SUSPENDED`): all data is kept and
  readable; billing, settings, support, export and the marketplace keep working; tenants can still
  report maintenance (keyword classification instead of AI); automatic provider dispatch pauses and
  the owner gets an escalation; AI replies pause and the sender is told a person will reply; rent
  reminders stop until a plan is active.
- **Units**: a managed unit is a non-archived `Unit` on a non-archived property of the organisation.
  Creation checks and creates inside one transaction holding a per-organisation advisory lock.
  At capacity the next unit is refused with `ENTITLEMENT_LIMIT_REACHED` (402) and an upgrade
  prompt; nothing is deleted. A downgrade over the limit is allowed with a warning and blocks new
  units until usage is within the limit.
- **Upgrade** starts when its payment is confirmed (new full period from that moment — no
  proration, the provider boundary has none). **Downgrade** is scheduled for the next renewal.
  Paying during the trial keeps the remaining trial days.

## Billing provider contract (to configure)

No real SaaS billing provider is configured yet. The HTTP adapter (`src/modules/billing/gateways/http.ts`)
expects a provider (or a thin service in front of Paystack/Hubtel/etc.) that implements:

- `POST /checkouts` `{ externalId, customerExternalId, customerName, customerEmail, planKey, billingCycle, currency, amount, returnUrl }` → `{ checkoutRef, checkoutUrl }` (`checkoutUrl` must be `https://`).
- Webhook to `POST /api/webhooks/billing/http`, HMAC-SHA256 of the raw body in `x-billing-signature`, events:
  `CHECKOUT_PAID` / `CHECKOUT_FAILED` `{ eventId, eventType, checkoutRef, providerInvoiceRef, amount, currency, failureReason }`,
  and for recurring mandates `INVOICE_PAID` / `INVOICE_FAILED` / `SUBSCRIPTION_CANCELLED` with `subscriptionRef`.
- The amount and currency in a paid event must equal what NesAfric priced, otherwise the event is
  recorded as `MISMATCHED` and grants nothing.

Until it is configured, production shows "Online payment is not available yet" and plans can be
granted only by a platform admin (forced plan change or entitlement override, both audited). The
deterministic `test` provider is refused when `NODE_ENV=production`.

## Environment variables (names only)

`BILLING_HTTP_BASE_URL`, `BILLING_HTTP_API_KEY`, `BILLING_HTTP_WEBHOOK_SECRET`, `BILLING_HTTP_TIMEOUT_MS`
(provider); `APP_BASE_URL` (checkout return URL); `JOBS_RUN_SECRET` or `CRON_SECRET` (the lifecycle
sweep runs from `/api/jobs/run` and the worker); `BILLING_TEST_WEBHOOK_SECRET` (tests/dev only).
