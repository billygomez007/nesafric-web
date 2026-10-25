import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/platform/database/client";
import { registerUser } from "@/modules/identity/service";
import {
  addMarketplaceMember,
  createMarketplaceProfessional,
  getMarketplaceProfessional,
  getPublicMarketplaceProfessionalProfile,
  reviewMarketplaceVerification,
  updateMarketplaceProfessional,
} from "@/modules/marketplace-professionals/service";
import {
  removeMarketplaceProfessionalLogo,
  removeMarketplaceProfessionalLogoAsPlatform,
  uploadMarketplaceProfessionalLogo,
  uploadMarketplaceProfessionalLogoAsPlatform,
} from "@/modules/documents/service";
import {
  createHomepageCompanyLogo,
  listHomepageMediaForPlatform,
  listPublicHomepageCompanies,
} from "@/modules/platform-admin/homepage-media-service";
import { VALID_PNG } from "./helpers/images";

// A valid 1×1 PNG; `pngOfSize` pads it to exercise the size limit without changing its type.
const PNG = VALID_PNG;
const logo = (fileName = "logo.png", bytes = PNG) => ({ fileName, contentType: "image/png", dataBase64: bytes.toString("base64") });

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner" CASCADE');
  await db.tenant.deleteMany();
  await db.platformAuditEvent.deleteMany();
}

let counter = 0;
const email = (label: string) => `${label}-${++counter}@example.com`;
const user = (label: string) => registerUser({ displayName: label, email: email(label), password: "secure-password-123" });

async function makeCompany(displayName = "Canal PC", type = "REAL_ESTATE_COMPANY") {
  const owner = await user("owner");
  const professional = await createMarketplaceProfessional(owner.id, {
    type, displayName, countryCode: "GH", legalName: `${displayName} Ltd`, description: "Original description.",
    contactEmail: "hello@example.com", specialities: ["Sales"], servicesOffered: ["Valuation"], serviceAreas: ["Accra"],
  });
  return { owner, professional };
}

async function addMember(ownerId: string, professionalId: string, role: "ADMIN" | "AGENT") {
  const member = await user(role.toLowerCase());
  await addMarketplaceMember(ownerId, professionalId, { email: member.email, role });
  return member;
}

async function makeAdmin(role: "SUPER_ADMIN" | "BILLING_ADMIN" | "READ_ONLY" = "SUPER_ADMIN") {
  const account = await user(`platform-${role.toLowerCase()}`);
  const principal = await db.platformPrincipal.create({ data: { userId: account.id, role, status: "ACTIVE", createdVia: "MANUAL" } });
  return { user: account, principal };
}

describe("business self-service profile editing", () => {
  beforeEach(cleanDatabase);
  afterAll(async () => { await cleanDatabase(); await db.$disconnect(); });

  it("OWNER and ADMIN can edit; unspecified fields are kept; the change is audited with the business user", async () => {
    const { owner, professional } = await makeCompany();
    const updated = await updateMarketplaceProfessional(owner.id, professional.id, { description: "Updated description.", websiteUrl: "https://canal.example.com" });
    expect(updated).toMatchObject({
      description: "Updated description.", websiteUrl: "https://canal.example.com",
      displayName: "Canal PC", legalName: "Canal PC Ltd", contactEmail: "hello@example.com",
      specialities: ["Sales"], servicesOffered: ["Valuation"], serviceAreas: ["Accra"], type: "REAL_ESTATE_COMPANY", countryCode: "GH",
    });

    const admin = await addMember(owner.id, professional.id, "ADMIN");
    const byAdmin = await updateMarketplaceProfessional(admin.id, professional.id, { serviceAreas: ["Accra", "Kumasi"], legalName: null });
    expect(byAdmin).toMatchObject({ serviceAreas: ["Accra", "Kumasi"], legalName: null, description: "Updated description." });

    const audits = await db.auditEvent.findMany({ where: { entityId: professional.id, action: "marketplace_professional.updated" }, orderBy: { createdAt: "asc" } });
    expect(audits.map((audit) => [audit.actorUserId, audit.metadata])).toEqual([
      [owner.id, { fields: ["description", "websiteUrl"] }],
      [admin.id, { fields: ["legalName", "serviceAreas"] }],
    ]);

    expect((await getMarketplaceProfessional(admin.id, professional.id)).myRole).toBe("ADMIN");
  });

  it("AGENT and members of another company cannot edit", async () => {
    const { owner, professional } = await makeCompany();
    const agent = await addMember(owner.id, professional.id, "AGENT");
    await expect(updateMarketplaceProfessional(agent.id, professional.id, { displayName: "Hijacked" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await getMarketplaceProfessional(agent.id, professional.id)).myRole).toBe("AGENT");

    const other = await makeCompany("Other Co");
    await expect(updateMarketplaceProfessional(other.owner.id, professional.id, { displayName: "Hijacked" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(uploadMarketplaceProfessionalLogo(other.owner.id, professional.id, logo())).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(uploadMarketplaceProfessionalLogo(agent.id, professional.id, logo())).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect((await db.marketplaceProfessional.findUniqueOrThrow({ where: { id: professional.id } })).displayName).toBe("Canal PC");
  });

  it("does not accept an arbitrary logo URL, and type/country stay read-only", async () => {
    const { owner, professional } = await makeCompany();
    await expect(updateMarketplaceProfessional(owner.id, professional.id, { logoUrl: "https://evil.example.com/logo.png" })).rejects.toMatchObject({ name: "ZodError" });
    const unchanged = await updateMarketplaceProfessional(owner.id, professional.id, { displayName: "Canal PC", type: "BROKER", countryCode: "NG" } as never);
    expect(unchanged).toMatchObject({ type: "REAL_ESTATE_COMPANY", countryCode: "GH" });
  });

  it("uploads, replaces and removes the logo in MarketplaceProfessional.logoUrl", async () => {
    const { owner, professional } = await makeCompany();

    const first = await uploadMarketplaceProfessionalLogo(owner.id, professional.id, logo("first.png"));
    expect(first.logoUrl).toBeTruthy();
    const firstObject = await db.storageObject.findFirstOrThrow({ where: { targetType: "MARKETPLACE_PROFESSIONAL_LOGO", targetId: professional.id } });
    expect(firstObject).toMatchObject({ classification: "PUBLIC", archivedAt: null, uploadedByUserId: owner.id, organisationId: professional.backingOrganisationId });
    expect(firstObject.storageKey).toMatch(/^public\/marketplace-professionals\/branding\//);

    const second = await uploadMarketplaceProfessionalLogo(owner.id, professional.id, logo("second.png"));
    expect(second.logoUrl).not.toBe(first.logoUrl);
    expect((await db.storageObject.findUniqueOrThrow({ where: { id: firstObject.id } })).archivedAt).toBeInstanceOf(Date);
    expect(await db.storageObject.count({ where: { targetType: "MARKETPLACE_PROFESSIONAL_LOGO", targetId: professional.id, archivedAt: null } })).toBe(1);
    expect((await db.marketplaceProfessional.findUniqueOrThrow({ where: { id: professional.id } })).logoUrl).toBe(second.logoUrl);

    await removeMarketplaceProfessionalLogo(owner.id, professional.id);
    const after = await db.marketplaceProfessional.findUniqueOrThrow({ where: { id: professional.id } });
    expect(after).toMatchObject({ logoUrl: null, displayName: "Canal PC", description: "Original description." });
    expect(await db.storageObject.count({ where: { targetType: "MARKETPLACE_PROFESSIONAL_LOGO", targetId: professional.id, archivedAt: null } })).toBe(0);

    const actions = (await db.auditEvent.findMany({ where: { entityId: professional.id, action: { startsWith: "marketplace_professional.logo_" } }, orderBy: { createdAt: "asc" } }))
      .map((audit) => [audit.action, audit.actorUserId]);
    expect(actions).toEqual([
      ["marketplace_professional.logo_updated", owner.id],
      ["marketplace_professional.logo_updated", owner.id],
      ["marketplace_professional.logo_removed", owner.id],
    ]);
  });

  it("removes the logo through PATCH logoUrl: null as well", async () => {
    const { owner, professional } = await makeCompany();
    await uploadMarketplaceProfessionalLogo(owner.id, professional.id, logo());
    const updated = await updateMarketplaceProfessional(owner.id, professional.id, { logoUrl: null, contactPhone: "+233200000000" });
    expect(updated).toMatchObject({ logoUrl: null, contactPhone: "+233200000000" });
    expect(await db.auditEvent.count({ where: { entityId: professional.id, action: "marketplace_professional.logo_removed" } })).toBe(1);
  });

  it("rejects non-image and oversized logo files", async () => {
    const { owner, professional } = await makeCompany();
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n", "utf8");
    await expect(uploadMarketplaceProfessionalLogo(owner.id, professional.id, { fileName: "logo.pdf", contentType: "application/pdf", dataBase64: pdf.toString("base64") }))
      .rejects.toMatchObject({ code: "UNSUPPORTED_FILE_TYPE" });
    const big = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]);
    await expect(uploadMarketplaceProfessionalLogo(owner.id, professional.id, logo("big.png", big))).rejects.toMatchObject({ code: "LOGO_TOO_LARGE" });
    expect((await db.marketplaceProfessional.findUniqueOrThrow({ where: { id: professional.id } })).logoUrl).toBeNull();
  });

  it("shows the new logo on the public profile", async () => {
    const { owner, professional } = await makeCompany();
    const uploaded = await uploadMarketplaceProfessionalLogo(owner.id, professional.id, logo());
    expect((await getPublicMarketplaceProfessionalProfile(professional.slug)).logoUrl).toBe(uploaded.logoUrl);
  });

  it("an already-featured company's new logo appears in the homepage rail without re-adding it", async () => {
    const admin = await makeAdmin();
    const { owner, professional } = await makeCompany();
    await reviewMarketplaceVerification(admin.user, professional.id, { status: "VERIFIED" });
    const item = await createHomepageCompanyLogo(admin.principal, admin.user.id, { marketplaceProfessionalId: professional.id, isPublished: true });
    expect((await listPublicHomepageCompanies())[0].logoUrl).toBeNull();

    const uploaded = await uploadMarketplaceProfessionalLogo(owner.id, professional.id, logo());
    const rail = await listPublicHomepageCompanies();
    expect(rail).toHaveLength(1);
    expect(rail[0]).toMatchObject({ id: item.id, logoUrl: uploaded.logoUrl });
    expect((await listHomepageMediaForPlatform(admin.principal)).items[0].marketplaceProfessional.logoUrl).toBe(uploaded.logoUrl);
    expect(await db.homepageCompanyLogo.count()).toBe(1);

    const replaced = await uploadMarketplaceProfessionalLogo(owner.id, professional.id, logo("new.png"));
    expect((await listPublicHomepageCompanies())[0].logoUrl).toBe(replaced.logoUrl);
  });

  it("platform admin logo editing works independently and is audited on the platform log", async () => {
    const admin = await makeAdmin();
    const { owner, professional } = await makeCompany();
    const uploaded = await uploadMarketplaceProfessionalLogoAsPlatform(admin.principal, professional.id, logo());
    expect((await db.marketplaceProfessional.findUniqueOrThrow({ where: { id: professional.id } })).logoUrl).toBe(uploaded.logoUrl);

    // The business sees and can replace the same logo.
    expect((await getMarketplaceProfessional(owner.id, professional.id)).logoUrl).toBe(uploaded.logoUrl);
    const byBusiness = await uploadMarketplaceProfessionalLogo(owner.id, professional.id, logo("business.png"));
    expect(byBusiness.logoUrl).not.toBe(uploaded.logoUrl);

    await removeMarketplaceProfessionalLogoAsPlatform(admin.principal, professional.id);
    expect((await db.marketplaceProfessional.findUniqueOrThrow({ where: { id: professional.id } })).logoUrl).toBeNull();

    const platformActions = (await db.platformAuditEvent.findMany({ where: { entityId: professional.id }, orderBy: { createdAt: "asc" } })).map((event) => event.action);
    expect(platformActions).toEqual(["marketplace_professional.logo_updated", "marketplace_professional.logo_removed"]);

    for (const role of ["BILLING_ADMIN", "READ_ONLY"] as const) {
      const other = await makeAdmin(role);
      await expect(uploadMarketplaceProfessionalLogoAsPlatform(other.principal, professional.id, logo())).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(removeMarketplaceProfessionalLogoAsPlatform(other.principal, professional.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("a logo does not change homepage eligibility: verified non-company types stay excluded", async () => {
    const admin = await makeAdmin();
    for (const type of ["INDIVIDUAL_AGENT", "BROKER", "OTHER"]) {
      const { owner, professional } = await makeCompany(`Verified ${type}`, type);
      await reviewMarketplaceVerification(admin.user, professional.id, { status: "VERIFIED" });
      await uploadMarketplaceProfessionalLogo(owner.id, professional.id, logo());
      await expect(createHomepageCompanyLogo(admin.principal, admin.user.id, { marketplaceProfessionalId: professional.id, isPublished: true }))
        .rejects.toThrow("Only active, verified marketplace companies can be featured on the homepage.");
    }
  });
});
