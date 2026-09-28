import { afterAll, describe, expect, it } from "vitest";

import { db } from "@/platform/database/client";

/**
 * Guards the local test-database setup that once failed with `P1010: User was denied access`: a
 * DATABASE_URL without a user name works for psql (it falls back to the OS user) but not for
 * Prisma. The URL must name the role explicitly, Prisma must connect as that role, and the
 * database must be fully migrated (including the passwordless-auth migration).
 */
describe("integration database identity", () => {
  afterAll(async () => {
    await db.$disconnect();
  });

  it("names its role explicitly and Prisma connects as that same role", async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    expect(decodeURIComponent(url.username)).not.toBe("");
    const [{ current_user: role }] = await db.$queryRaw<{ current_user: string }[]>`SELECT current_user::text AS current_user`;
    expect(role).toBe(decodeURIComponent(url.username));
  });

  it("has every migration applied and none failed", async () => {
    const rows = await db.$queryRaw<{ migration_name: string; finished: boolean; rolled_back: boolean }[]>`
      SELECT migration_name, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back FROM "_prisma_migrations"`;
    expect(rows.every((row) => row.finished && !row.rolled_back)).toBe(true);
    expect(rows.map((row) => row.migration_name)).toEqual(expect.arrayContaining([
      "20260928120000_mobile_google_auth_handoff",
      "20260928121000_marketplace_top_ads",
      "20260928130000_passwordless_otp_auth",
    ]));
  });

  it("enforces the User identity invariants in the database itself", async () => {
    const checks = await db.$queryRaw<{ conname: string }[]>`SELECT conname::text AS conname FROM pg_constraint WHERE conname IN ('User_has_identifier_check', 'User_phoneE164_format_check')`;
    expect(checks.map((row) => row.conname).sort()).toEqual(["User_has_identifier_check", "User_phoneE164_format_check"]);
    await expect(db.user.create({ data: { displayName: "Nobody" } })).rejects.toThrow();
    await expect(db.user.create({ data: { displayName: "Bad phone", phoneE164: "0241234567" } })).rejects.toThrow();
  });
});
