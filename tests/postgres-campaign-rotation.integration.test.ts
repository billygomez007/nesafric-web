import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/platform/database/client";
import { registerUser } from "@/modules/identity/service";
import { getPlacementRotationForPlatform, setPlacementRotation } from "@/modules/campaigns/rotation";
import { GET as publicCampaignsRoute } from "@/app/api/public/campaigns/route";
import { requirePlatformPrincipal } from "@/platform/platform-admin/auth";

/** Super Admin's placement-wide carousel rotation, as the website and the app read it. */

async function cleanDatabase() {
  await db.campaignPlacementSetting.deleteMany();
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner" CASCADE');
}

async function principal(role: "SUPER_ADMIN" | "READ_ONLY") {
  const user = await registerUser({ displayName: "Rotation Admin", email: `rotation-${Math.random().toString(36).slice(2)}@example.com`, password: "secure-password-123" });
  await db.platformPrincipal.create({ data: { userId: user.id, role, status: "ACTIVE", createdVia: "MANUAL" } });
  return requirePlatformPrincipal(user);
}

async function publicRotation(placement = "MARKETPLACE_PRIMARY") {
  const response = await publicCampaignsRoute(new Request(`http://localhost/api/public/campaigns?placement=${placement}&countryCode=GH&limit=6`));
  expect(response.status).toBe(200);
  return ((await response.json()) as { rotationSeconds: number }).rotationSeconds;
}

describe("campaign carousel rotation", () => {
  beforeEach(cleanDatabase);
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("defaults to 5 seconds with no saved setting", async () => {
    expect(await publicRotation()).toBe(5);
    expect(await getPlacementRotationForPlatform(await principal("SUPER_ADMIN"), "MARKETPLACE_PRIMARY")).toMatchObject({ rotationSeconds: 5, options: [5, 8, 10] });
  });

  it("Super Admin can choose 8 or 10 seconds; the public carousel API returns it and it is audited", async () => {
    const admin = await principal("SUPER_ADMIN");
    await setPlacementRotation(admin, "MARKETPLACE_PRIMARY", { rotationSeconds: 8 });
    expect(await publicRotation()).toBe(8);
    await setPlacementRotation(admin, "MARKETPLACE_PRIMARY", { rotationSeconds: 10 });
    expect(await publicRotation()).toBe(10);
    // Placement-wide, not global: other placements keep the default.
    expect(await publicRotation("MARKETPLACE_INLINE")).toBe(5);
    const audit = await db.platformAuditEvent.findMany({ where: { action: "platform_admin.campaign_rotation_updated" }, orderBy: { createdAt: "asc" } });
    expect(audit.map((event) => event.metadata)).toEqual([{ previous: 5, rotationSeconds: 8 }, { previous: 8, rotationSeconds: 10 }]);
  });

  it.each([0, 3, 7, 12, "8", null])("rejects %s seconds", async (value) => {
    await expect(setPlacementRotation(await principal("SUPER_ADMIN"), "MARKETPLACE_PRIMARY", { rotationSeconds: value })).rejects.toThrow();
    expect(await publicRotation()).toBe(5);
  });

  it("the database refuses any other value too", async () => {
    await expect(db.campaignPlacementSetting.create({ data: { placement: "MARKETPLACE_PRIMARY", rotationSeconds: 7 } })).rejects.toThrow();
  });

  it("rejects an unknown placement and a role without campaign permissions", async () => {
    await expect(setPlacementRotation(await principal("SUPER_ADMIN"), "NOT_A_PLACEMENT", { rotationSeconds: 8 })).rejects.toThrow();
    await expect(setPlacementRotation(await principal("READ_ONLY"), "MARKETPLACE_PRIMARY", { rotationSeconds: 8 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await publicRotation()).toBe(5);
  });
});
