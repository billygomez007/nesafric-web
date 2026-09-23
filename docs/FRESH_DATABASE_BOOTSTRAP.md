# NesAfric Fresh Database Bootstrap

The historical migration directory contains migrations whose filename order does not match the order in which they were originally applied.

In particular:

- `20260829070919_phase25_service_category_admin_controls` alters `ProviderDocumentRequirement`.
- `20260829130000_phase23_property_service_professionals` creates `ProviderDocumentRequirement`.

Existing historical migrations must not be renamed or modified because Prisma records their migration names and checksums.

For a completely new empty database, use the fresh-database bootstrap command.

The bootstrap:

1. Creates the schema represented by the current Prisma schema.
2. Registers historical migrations as incorporated into the baseline.
3. Runs Prisma migrate deploy to confirm no historical migration remains pending.
4. Generates the Prisma client.

Existing production databases must continue using the normal migration deployment workflow.

Do not use the fresh bootstrap command against an existing database containing application data.
