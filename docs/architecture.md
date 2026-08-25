# Architecture decisions

## Modular monolith

Phase 1 is deployed as one application to reduce operational overhead while retaining module boundaries that can later become services only when scale justifies it.

## Tenant isolation

Organisation identity is derived from an authenticated active membership. It is not trusted merely because a browser sends an organisation identifier. Queries include `organisationId`, mutations require a permission on that organisation, and cross-organisation access returns no resource.

## Events and audit

Domain events are persisted transactionally with domain writes. Event consumers can later process unprocessed records idempotently. Audit events are append-only and cannot be changed through application endpoints.
