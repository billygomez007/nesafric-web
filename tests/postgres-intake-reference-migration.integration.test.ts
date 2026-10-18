import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { createProperty } from "@/modules/assets/service";
import { db } from "@/platform/database/client";

/**
 * Runs migration 20261019150000 exactly as committed against a table holding legacy data in the
 * shape the earlier schema allowed (an unbounded, arbitrary `classification` JSON). The test
 * database is first put back to the pre-migration shape; the migration then restores it.
 */
const MIGRATION = readFileSync(path.join(process.cwd(), "prisma/migrations/20261019150000_maintenance_intake_reference/migration.sql"), "utf8");

const longA = randomBytes(15_000).toString("base64");
const longB = `${longA.slice(0, 5_000)}${randomBytes(9_000).toString("base64")}`;
type Row = { id: string; organisationId: string; label: string; classification: unknown; createdAt: string };

const rows: Row[] = [];
let migrationError: unknown = null;

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner", "BackgroundJob" CASCADE');
}

describe("PostgreSQL migration 20261019150000 on existing data", () => {
  beforeAll(async () => {
    await cleanDatabase();
    const owner = await registerUser({ displayName: "Owner", email: "owner@example.com", password: "secure-password-123" });
    const organisations: Array<{ id: string }> = [];
    for (const name of ["One", "Two"]) organisations.push(await createOrganisation(owner.id, { name: `Org ${name}`, type: "INDIVIDUAL_LANDLORD", countryCode: "GH" }));
    const properties: Array<{ id: string }> = [];
    for (const [index, organisation] of organisations.entries()) properties.push(await createProperty(owner.id, organisation.id, { name: `Property ${index}`, referenceNumber: `P-${index}`, category: "Residential", countryCode: "GH", currencyCode: "GHS", units: [] }));

    // Back to the shape before this migration.
    await db.$executeRawUnsafe(`DROP INDEX IF EXISTS "MaintenanceRequest_organisationId_intakeReference_key"`);
    await db.$executeRawUnsafe(`ALTER TABLE "MaintenanceRequest" DROP CONSTRAINT IF EXISTS "MaintenanceRequest_intakeReference_length_check"`);
    await db.$executeRawUnsafe(`ALTER TABLE "MaintenanceRequest" DROP COLUMN IF EXISTS "intakeReference"`);

    const add = (label: string, organisationIndex: number, classification: unknown, minutes: number) => rows.push({ id: randomUUID(), organisationId: organisations[organisationIndex].id, label, classification, createdAt: new Date(Date.UTC(2026, 9, 1, 0, minutes)).toISOString() });
    add("normal", 0, { sourceMessageId: "wamid.HBgMMjMzMjQxMjM0NTY3FQIAEhgUM0E", category: "plumbing" }, 1);
    add("duplicate-first", 0, { sourceMessageId: "wamid.duplicate.1" }, 2);
    add("duplicate-second", 0, { sourceMessageId: "wamid.duplicate.1" }, 3);
    add("same-id-other-org", 1, { sourceMessageId: "wamid.duplicate.1" }, 4);
    add("no-key", 0, { category: "plumbing" }, 5);
    add("null-classification", 0, null, 6);
    add("json-null", 0, { sourceMessageId: null }, 7);
    add("number", 0, { sourceMessageId: 12345 }, 8);
    add("object", 0, { sourceMessageId: { id: "x" } }, 9);
    add("empty-string", 0, { sourceMessageId: "" }, 10);
    add("unsafe-characters", 0, { sourceMessageId: "message id with spaces & ünïcode" }, 11);
    add("long-a", 0, { sourceMessageId: longA }, 12);
    add("long-b-shares-prefix", 0, { sourceMessageId: longB }, 13);
    add("long-a-duplicate", 0, { sourceMessageId: longA }, 14);
    for (const row of rows) {
      const propertyId = properties[organisations.findIndex((organisation) => organisation.id === row.organisationId)].id;
      await db.$executeRawUnsafe(`INSERT INTO "MaintenanceRequest" ("id", "organisationId", "propertyId", "reportedByUserId", "title", "description", "category", "classification", "createdAt", "updatedAt")
        VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, 'Legacy request', 'plumbing', $6::jsonb, $7::timestamp, $7::timestamp)`, row.id, row.organisationId, propertyId, owner.id, row.label, row.classification === null ? null : JSON.stringify(row.classification), row.createdAt);
    }

    // The committed file, statement by statement, in one transaction (as `migrate deploy` does).
    const statements = MIGRATION.split(/;\s*\n/).map((statement) => statement.replace(/^\s*--.*$/gm, "").trim()).filter(Boolean);
    try {
      await db.$transaction(async (tx) => { for (const statement of statements) await tx.$executeRawUnsafe(statement); }, { timeout: 60_000 });
    } catch (error) {
      migrationError = error;
      // Leave the database usable for the suites that follow.
      await db.$executeRawUnsafe(`ALTER TABLE "MaintenanceRequest" ADD COLUMN IF NOT EXISTS "intakeReference" TEXT`);
      await db.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "MaintenanceRequest_organisationId_intakeReference_key" ON "MaintenanceRequest"("organisationId", "intakeReference")`);
    }
  });

  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  const references = async () => new Map((await db.$queryRawUnsafe<Array<{ title: string; intakeReference: string | null }>>(`SELECT "title", "intakeReference" FROM "MaintenanceRequest"`)).map((row) => [row.title, row.intakeReference]));

  it("applies without error and keeps every request", async () => {
    expect(migrationError).toBeNull();
    const [{ count }] = await db.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT count(*) AS count FROM "MaintenanceRequest"`);
    expect(Number(count)).toBe(rows.length);
  });

  it("keeps normal WhatsApp ids in the form new reports use, once per organisation", async () => {
    const map = await references();
    expect(map.get("normal")).toBe("whatsapp:wamid.HBgMMjMzMjQxMjM0NTY3FQIAEhgUM0E");
    expect(map.get("duplicate-first")).toBe("whatsapp:wamid.duplicate.1");
    expect(map.get("duplicate-second")).toBeNull();
    expect(map.get("same-id-other-org")).toBe("whatsapp:wamid.duplicate.1");
  });

  it("gives missing, null, non-string and empty values no reference", async () => {
    const map = await references();
    for (const label of ["no-key", "null-classification", "json-null", "number", "object", "empty-string"]) expect([label, map.get(label)]).toEqual([label, null]);
  });

  it("maps long or unusual ids to bounded, distinct SHA-256 references without merging different values", async () => {
    const map = await references();
    const hashed = /^whatsapp-sha256:[0-9a-f]{64}$/;
    expect(map.get("unsafe-characters")).toMatch(hashed);
    expect(map.get("long-a")).toMatch(hashed);
    expect(map.get("long-b-shares-prefix")).toMatch(hashed);
    expect(map.get("long-a")).not.toBe(map.get("long-b-shares-prefix"));
    expect(map.get("long-a-duplicate")).toBeNull();
    const [longest] = await db.$queryRawUnsafe<Array<{ max: number }>>(`SELECT max(char_length("intakeReference")) AS max FROM "MaintenanceRequest"`);
    expect(Number(longest.max)).toBeLessThanOrEqual(200);
  });

  it("enforces uniqueness per organisation and the length bound afterwards", async () => {
    const [row] = rows;
    const [property] = await db.$queryRawUnsafe<Array<{ propertyId: string; reportedByUserId: string }>>(`SELECT "propertyId", "reportedByUserId" FROM "MaintenanceRequest" WHERE "id" = $1::uuid`, row.id);
    const insert = (organisationId: string, reference: string) => db.$executeRawUnsafe(`INSERT INTO "MaintenanceRequest" ("id", "organisationId", "propertyId", "reportedByUserId", "title", "description", "category", "intakeReference", "updatedAt")
      VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'New', 'New', 'plumbing', $5, now())`, randomUUID(), organisationId, property.propertyId, property.reportedByUserId, reference);
    await expect(insert(row.organisationId, "whatsapp:wamid.HBgMMjMzMjQxMjM0NTY3FQIAEhgUM0E")).rejects.toThrow(/23505|unique/i);
    await expect(insert(row.organisationId, `whatsapp:${"x".repeat(200)}`)).rejects.toThrow(/23514|check constraint/i);
    await expect(insert(row.organisationId, "whatsapp:wamid.brand.new")).resolves.toBeTruthy();
  });
});
