# NesAfric Fresh Database Bootstrap

The historical migration directory contains migrations whose filename order does not match the order in which they were originally applied.

In particular:

- `20260829070919_phase25_service_category_admin_controls` alters `ProviderDocumentRequirement`.
- `20260829130000_phase23_property_service_professionals` creates `ProviderDocumentRequirement`.

Existing historical migrations must not be renamed or modified because Prisma records their migration names and checksums.

For a completely new empty database, use the fresh-database bootstrap command.

The bootstrap:

1. Enables required extensions.
2. Executes every historical migration's real SQL, in the order production applied them (filename order, except phase23 runs before phase25), and records each one as applied.
3. Fails if the resulting database differs from `prisma/schema.prisma` (`prisma migrate diff --exit-code`).
4. Runs Prisma migrate deploy to confirm no historical migration remains pending.
5. Generates the Prisma client.

Replaying the SQL matters: migrations create database objects the Prisma schema cannot express,
such as the triggers that make listing, verification and ledger history immutable. An earlier
version of this script used `prisma db push` and only registered the migrations, which silently
left those triggers out of every freshly bootstrapped database.

Existing production databases must continue using the normal migration deployment workflow.

Do not use the fresh bootstrap command against an existing database containing application data.
