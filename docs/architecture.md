# Architecture decisions

## Modular monolith

Phase 1 is deployed as one application to reduce operational overhead while retaining module boundaries that can later become services only when scale justifies it.

## Tenant isolation

Organisation identity is derived from an authenticated active membership. It is not trusted merely because a browser sends an organisation identifier. Queries include `organisationId`, mutations require a permission on that organisation, and cross-organisation access returns no resource.

## Events and audit

Domain events are persisted transactionally with domain writes. Event consumers can later process unprocessed records idempotently. Audit events are append-only and cannot be changed through application endpoints.

## Provider-neutral external integrations

External capabilities that could plausibly be satisfied by several competing vendors — payment
collection, communication channels, object storage, e-signature, geocoding, and calendar sync —
are never coded against one vendor's SDK. Each is a small adapter interface plus a registry
(`src/modules/*/provider.ts`), with every adapter independently reporting whether it is
configured. Credentials live in environment variables only, never in the database; an
organisation-scoped `IntegrationConfig` row tracks non-secret enablement and health
(`CONNECTED`/`NOT_CONFIGURED`/`DEGRADED`/`ERROR`) so status pages and settings screens never touch
a raw secret. Every provider category ships a deterministic, credential-free fallback (internal
signing, a small offline geocoding table, no-op calendar sync) so core functionality is never
blocked by an unconfigured or unreachable third party.

## Object storage

File bytes are never stored in the database. `StorageObject` is the single canonical metadata
record for every stored file — uploaded or generated — addressed by an opaque `storageKey` that
only the active `ObjectStorageAdapter` (S3-compatible in production, filesystem/in-memory
otherwise) can resolve to bytes. Uploads are private by default; only explicitly public listing
marketplace media is ever served without authentication, and even then through an opaque
key/route rather than a direct filesystem or bucket path. Generated legal/financial documents
(receipts, statements, lease agreements) are immutable and versioned: regenerating identical
source data returns the already-issued document, and a genuine change creates a new version
rather than overwriting the previous one.

## Commercial SaaS layer (Phase 20)

`OrganisationSubscription` is a 1:1 attribute of the existing `Organisation` — created
transactionally the moment an organisation is created (`TRIALING`, on the `starter` plan) — never
a second, duplicate account/tenant concept. A single entitlement service
(`src/modules/entitlements/`) resolves the boolean/limit in force for a feature key, in order:
an active `OrganisationEntitlementOverride` (a platform-granted, time-bound exception), then the
organisation's plan (`SubscriptionPlan` → `PlanEntitlement`), then a safe disabled/zero default.
Usage projections (`src/modules/entitlements/usage.ts`) are deterministic aggregate queries over
already-authoritative tables — a live count for "capacity" resources (properties, units, team
seats, AI employees, listings, storage bytes) and a current-billing-period aggregate for "flow"
resources (AI tokens/cost, generated documents, channel messages, integration operations,
the last reusing the existing `AuditEvent` integration-outcome trail rather than a second ledger.
A downgrade or a subscription that lapses into `SUSPENDED`/`CANCELLED` never deletes a single
record: it only blocks *creating more* of an over-limit resource, and blocks further mutation
entirely while read access stays intact, so a landlord never loses visibility into their own data.

SaaS billing (`src/modules/billing/`) — what NesAfric charges an organisation for its
subscription — is a completely separate provider-neutral adapter registry from tenant rent
collection (`src/modules/payments/`): different tables, different webhook route
(`/api/webhooks/billing/[providerKey]`), different registry. The default `test` adapter is
deterministic and credential-free so the full lifecycle (trial → active → past due → grace →
suspended, upgrade/downgrade, cancel) is exercisable with zero configuration; an `http` adapter
takes over once `BILLING_HTTP_BASE_URL`/`BILLING_HTTP_API_KEY` are configured. Every inbound
webhook is signature-verified before its body is even parsed (fail-closed) and recorded in
`BillingWebhookEvent`, mirroring `PaymentReconciliationEvent`'s `(providerKey, eventKey)`
idempotency/replay-protection exactly.

Platform administration (`src/platform/platform-admin/`, `src/modules/platform-admin/`) is an
entirely independent authorization system from organisation RBAC. A `PlatformPrincipal` links to
a `User` only to reuse the login/session mechanism; it shares no table, no role, and no permission
with `OrganisationMember`/`Role`/`Permission`, and is only ever created by an environment-variable
bootstrap (`PLATFORM_ADMIN_BOOTSTRAP_EMAILS`) or a manual, operator-run script
(`scripts/bootstrap-platform-admin.ts`) — never by any HTTP endpoint. Viewing a specific
organisation's detail additionally requires an active, reasoned `PlatformSupportSession`, itself
visible to the organisation through its own billing settings, so support access is always audited
and never silent. Every platform action is logged to `PlatformAuditEvent`, kept fully separate
from an organisation's own `AuditEvent` history. Feature flags (`src/modules/feature-flags/`) are
a third, separate axis again — global/percentage-cohort/org-override/emergency-disable — answering
"is this capability rolled out" rather than "is this permitted" (RBAC) or "is this entitled"
(commercial plan).
