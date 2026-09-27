import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(relative: string) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

describe("tenant access implementation structure", () => {
  it("stores only the invitation hash in the migration", () => {
    const migration = read(
      "prisma/migrations/20260927040000_tenant_access_invitations/migration.sql",
    );

    expect(migration).toContain('"tokenHash" TEXT NOT NULL');
    expect(migration).toContain(
      '"TenantAccessInvitation_tokenHash_key"',
    );

    expect(migration).not.toMatch(
      /"(?:code|token|rawCode|rawToken)"\s+(?:TEXT|VARCHAR)/i,
    );
  });

  it("keeps TenantOrganisation.userId as the canonical tenant account link", () => {
    const schema = read("prisma/schema.prisma");

    expect(schema).toMatch(
      /model TenantOrganisation[\s\S]*?userId\s+String\?/,
    );

    expect(schema).toMatch(
      /model TenantOrganisation[\s\S]*?accessInvitations\s+TenantAccessInvitation\[\]/,
    );
  });

  it("does not repurpose the marketplace public-write kinds", () => {
    const source = read(
      "src/platform/security/public-write-limit.ts",
    );

    expect(source).toContain(
      'export type PublicWriteKind = "enquiry" | "viewing"',
    );

    expect(source).not.toContain("tenant-access");
  });

  it("tenant redemption requires authentication", () => {
    const source = read(
      "src/app/api/account/tenant-access/redeem/route.ts",
    );

    expect(source).toContain("requireUser()");
    expect(source).toContain("reserveTenantAccessAttempt");
  });

  it("tenant validation requires authentication and rate limiting", () => {
    const source = read(
      "src/app/api/account/tenant-access/validate/route.ts",
    );

    expect(source).toContain("requireUser()");
    expect(source).toContain("reserveTenantAccessAttempt");
  });

  it("staff invitation creation uses organisation-scoped authorization", () => {
    const source = read(
      "src/modules/tenants/access-invitations.ts",
    );

    expect(source).toContain(
      "PERMISSIONS.tenantUpdate",
    );

    expect(source).toContain(
      "organisationId",
    );
  });

  it("redemption row-locks the invitation and tenant relationship", () => {
    const source = read(
      "src/modules/tenants/access-invitations.ts",
    );

    const locks = source.match(/FOR UPDATE/g) ?? [];
    expect(locks.length).toBeGreaterThanOrEqual(2);
  });

  it("redemption never accepts a tenantOrganisationId from the account route", () => {
    const source = read(
      "src/app/api/account/tenant-access/redeem/route.ts",
    );

    expect(source).toContain(
      'code: z.string()',
    );

    expect(source).not.toContain(
      "tenantOrganisationId:",
    );
  });
});
