import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/platform/database/client";
import { registerUser } from "@/modules/identity/service";
import {
  createMarketplaceProfessional,
  reviewMarketplaceVerification,
  setMarketplaceProfessionalAccountStatus,
  submitMarketplaceVerification,
} from "@/modules/marketplace-professionals/service";
import {
  createHomepageCompanyLogo,
  deleteHomepageCompanyLogo,
  listHomepageMediaForPlatform,
  listPublicHomepageCompanies,
  reorderHomepageCompanyLogos,
  updateHomepageCompanyLogo,
} from "@/modules/platform-admin/homepage-media-service";

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner" CASCADE');
  await db.tenant.deleteMany();
  await db.platformAuditEvent.deleteMany();
}

let counter = 0;
const email = (label: string) => `${label}-${++counter}@example.com`;

async function makeAdmin(role: "SUPER_ADMIN" | "BILLING_ADMIN" | "SUPPORT_AGENT" | "READ_ONLY" = "SUPER_ADMIN") {
  const user = await registerUser({ displayName: `Admin ${role}`, email: email(`admin-${role.toLowerCase()}`), password: "secure-password-123" });
  const principal = await db.platformPrincipal.create({ data: { userId: user.id, role, status: "ACTIVE", createdVia: "MANUAL" } });
  return { user, principal };
}

async function makeCompany(displayName: string, type = "REAL_ESTATE_COMPANY") {
  const owner = await registerUser({ displayName, email: email("owner"), password: "secure-password-123" });
  const professional = await createMarketplaceProfessional(owner.id, { type, displayName, countryCode: "GH" });
  return { owner, professional };
}

const auditActions = async (entityId: string) =>
  (await db.platformAuditEvent.findMany({ where: { entityId }, orderBy: { createdAt: "asc" } })).map((event) => event.action);

describe("platform admin: company verification", () => {
  beforeEach(cleanDatabase);
  afterAll(async () => { await cleanDatabase(); await db.$disconnect(); });

  it("SUPER_ADMIN verifies an UNVERIFIED company directly and the decision is recorded", async () => {
    const admin = await makeAdmin();
    const { professional } = await makeCompany("Canal PC");
    expect(professional.verificationStatus).toBe("UNVERIFIED");

    const updated = await reviewMarketplaceVerification(admin.user, professional.id, { status: "VERIFIED", reason: "Registration checked." });
    expect(updated.verificationStatus).toBe("VERIFIED");

    const events = await db.marketplaceProfessionalVerificationEvent.findMany({ where: { marketplaceProfessionalId: professional.id } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ fromStatus: "UNVERIFIED", toStatus: "VERIFIED", actorUserId: admin.user.id, reason: "Registration checked." });
    expect(events[0].createdAt).toBeInstanceOf(Date);

    const audit = await db.platformAuditEvent.findFirstOrThrow({ where: { entityId: professional.id, action: "marketplace_professional.verified" } });
    expect(audit.platformPrincipalId).toBe(admin.principal.id);
    expect(audit.organisationId).toBe(professional.backingOrganisationId);
    expect(audit.metadata).toMatchObject({ fromStatus: "UNVERIFIED", toStatus: "VERIFIED" });
  });

  it("SUPER_ADMIN verifies a PENDING company", async () => {
    const admin = await makeAdmin();
    const { owner, professional } = await makeCompany("Pending Estates");
    await submitMarketplaceVerification(owner.id, professional.id, { evidenceReferences: ["registration.pdf"] });

    const updated = await reviewMarketplaceVerification(admin.user, professional.id, { status: "VERIFIED" });
    expect(updated.verificationStatus).toBe("VERIFIED");
  });

  it("denies users without the marketplace verification permission", async () => {
    const { owner, professional } = await makeCompany("Guarded Company");
    await expect(reviewMarketplaceVerification(owner, professional.id, { status: "VERIFIED" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    for (const role of ["BILLING_ADMIN", "READ_ONLY"] as const) {
      const admin = await makeAdmin(role);
      await expect(reviewMarketplaceVerification(admin.user, professional.id, { status: "VERIFIED" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    const unchanged = await db.marketplaceProfessional.findUniqueOrThrow({ where: { id: professional.id } });
    expect(unchanged.verificationStatus).toBe("UNVERIFIED");
  });

  it("requires a reason to reject", async () => {
    const admin = await makeAdmin();
    const { professional } = await makeCompany("Reject Me");
    await expect(reviewMarketplaceVerification(admin.user, professional.id, { status: "REJECTED" })).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    const rejected = await reviewMarketplaceVerification(admin.user, professional.id, { status: "REJECTED", reason: "Registration number does not match." });
    expect(rejected.verificationStatus).toBe("REJECTED");
    expect(await auditActions(professional.id)).toContain("marketplace_professional.verification_rejected");

    // An explicit reversal is allowed.
    const reversed = await reviewMarketplaceVerification(admin.user, professional.id, { status: "VERIFIED", reason: "Corrected documents received." });
    expect(reversed.verificationStatus).toBe("VERIFIED");
  });

  it("requires a reason to suspend verification, and a suspended verification can be reinstated", async () => {
    const admin = await makeAdmin();
    const { professional } = await makeCompany("Suspend Verify");
    await reviewMarketplaceVerification(admin.user, professional.id, { status: "VERIFIED" });

    await expect(reviewMarketplaceVerification(admin.user, professional.id, { status: "SUSPENDED" })).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    const suspended = await reviewMarketplaceVerification(admin.user, professional.id, { status: "SUSPENDED", reason: "Complaint under review." });
    expect(suspended.verificationStatus).toBe("SUSPENDED");

    const reinstated = await reviewMarketplaceVerification(admin.user, professional.id, { status: "VERIFIED" });
    expect(reinstated.verificationStatus).toBe("VERIFIED");

    const events = await db.marketplaceProfessionalVerificationEvent.findMany({ where: { marketplaceProfessionalId: professional.id }, orderBy: { createdAt: "asc" } });
    expect(events.map((event) => `${event.fromStatus}->${event.toStatus}`)).toEqual(["UNVERIFIED->VERIFIED", "VERIFIED->SUSPENDED", "SUSPENDED->VERIFIED"]);
    expect(await auditActions(professional.id)).toEqual([
      "marketplace_professional.verified",
      "marketplace_professional.verification_suspended",
      "marketplace_professional.verification_reinstated",
    ]);
  });

  it("refuses invalid transitions, stale decisions and archived profiles", async () => {
    const admin = await makeAdmin();
    const { professional } = await makeCompany("Edge Cases");
    await expect(reviewMarketplaceVerification(admin.user, professional.id, { status: "SUSPENDED", reason: "x" })).rejects.toMatchObject({ code: "INVALID_VERIFICATION_TRANSITION" });
    await expect(reviewMarketplaceVerification(admin.user, professional.id, { status: "VERIFIED", expectedStatus: "PENDING" })).rejects.toMatchObject({ code: "VERIFICATION_CHANGED" });

    await db.marketplaceProfessional.update({ where: { id: professional.id }, data: { archivedAt: new Date(), status: "ARCHIVED" } });
    await expect(reviewMarketplaceVerification(admin.user, professional.id, { status: "VERIFIED" })).rejects.toMatchObject({ code: "PROFESSIONAL_ARCHIVED" });
  });
});

describe("platform admin: account lifecycle", () => {
  beforeEach(cleanDatabase);

  it("suspends and reactivates an account without touching verification, and audits both", async () => {
    const admin = await makeAdmin();
    const { professional } = await makeCompany("Lifecycle Co");
    await reviewMarketplaceVerification(admin.user, professional.id, { status: "VERIFIED" });

    await expect(setMarketplaceProfessionalAccountStatus(admin.user, professional.id, { status: "SUSPENDED" })).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    const suspended = await setMarketplaceProfessionalAccountStatus(admin.user, professional.id, { status: "SUSPENDED", reason: "Unpaid invoices." });
    expect(suspended).toMatchObject({ status: "SUSPENDED", verificationStatus: "VERIFIED" });

    const active = await setMarketplaceProfessionalAccountStatus(admin.user, professional.id, { status: "ACTIVE" });
    expect(active).toMatchObject({ status: "ACTIVE", verificationStatus: "VERIFIED" });

    const audits = await db.platformAuditEvent.findMany({ where: { entityId: professional.id, action: { startsWith: "marketplace_professional.account_" } }, orderBy: { createdAt: "asc" } });
    expect(audits.map((audit) => audit.action)).toEqual(["marketplace_professional.account_suspended", "marketplace_professional.account_reactivated"]);
    expect(audits[0]).toMatchObject({ platformPrincipalId: admin.principal.id, metadata: { fromStatus: "ACTIVE", toStatus: "SUSPENDED", reason: "Unpaid invoices." } });
  });

  it("denies unauthorized users and refuses no-op or archived changes", async () => {
    const admin = await makeAdmin();
    const { owner, professional } = await makeCompany("Protected Co");
    await expect(setMarketplaceProfessionalAccountStatus(owner, professional.id, { status: "SUSPENDED", reason: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const readOnly = await makeAdmin("READ_ONLY");
    await expect(setMarketplaceProfessionalAccountStatus(readOnly.user, professional.id, { status: "SUSPENDED", reason: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(setMarketplaceProfessionalAccountStatus(admin.user, professional.id, { status: "ACTIVE" })).rejects.toMatchObject({ code: "INVALID_ACCOUNT_TRANSITION" });
    await expect(setMarketplaceProfessionalAccountStatus(admin.user, professional.id, { status: "ARCHIVED" })).rejects.toMatchObject({ name: "ZodError" });

    await db.marketplaceProfessional.update({ where: { id: professional.id }, data: { status: "ARCHIVED", archivedAt: new Date() } });
    await expect(setMarketplaceProfessionalAccountStatus(admin.user, professional.id, { status: "ACTIVE" })).rejects.toMatchObject({ code: "PROFESSIONAL_ARCHIVED" });
    expect(await auditActions(professional.id)).toEqual([]);
  });
});

describe("platform admin: homepage media workflow", () => {
  beforeEach(cleanDatabase);

  it("a company verified from the admin becomes selectable and can be added, published, unpublished, reordered and removed", async () => {
    const admin = await makeAdmin();
    const { professional } = await makeCompany("Canal PC");

    let media = await listHomepageMediaForPlatform(admin.principal);
    expect(media.permissions).toEqual({ canManageHomepage: true, canVerify: true });
    expect(media.candidates.map((entry) => entry.id)).toContain(professional.id);
    expect(media.eligibleProfessionals.map((entry) => entry.id)).not.toContain(professional.id);
    await expect(createHomepageCompanyLogo(admin.principal, admin.user.id, { marketplaceProfessionalId: professional.id, isPublished: true }))
      .rejects.toMatchObject({ code: "HOMEPAGE_COMPANY_INELIGIBLE", status: 422 });

    await reviewMarketplaceVerification(admin.user, professional.id, { status: "VERIFIED" });
    media = await listHomepageMediaForPlatform(admin.principal);
    expect(media.eligibleProfessionals.map((entry) => entry.id)).toContain(professional.id);

    const item = await createHomepageCompanyLogo(admin.principal, admin.user.id, { marketplaceProfessionalId: professional.id, isPublished: true });
    expect((await listPublicHomepageCompanies()).map((entry) => entry.displayName)).toEqual(["Canal PC"]);

    await updateHomepageCompanyLogo(admin.principal, admin.user.id, item.id, { isPublished: false });
    expect(await listPublicHomepageCompanies()).toEqual([]);
    await updateHomepageCompanyLogo(admin.principal, admin.user.id, item.id, { isPublished: true });
    expect(await listPublicHomepageCompanies()).toHaveLength(1);

    const second = await makeCompany("Second Developer", "DEVELOPER");
    await reviewMarketplaceVerification(admin.user, second.professional.id, { status: "VERIFIED" });
    const secondItem = await createHomepageCompanyLogo(admin.principal, admin.user.id, { marketplaceProfessionalId: second.professional.id, isPublished: true });
    expect(secondItem.sortOrder).toBeGreaterThan(item.sortOrder);
    expect((await listPublicHomepageCompanies()).map((entry) => entry.displayName)).toEqual(["Canal PC", "Second Developer"]);

    await reorderHomepageCompanyLogos(admin.principal, admin.user.id, { ids: [secondItem.id, item.id] });
    expect((await listPublicHomepageCompanies()).map((entry) => entry.displayName)).toEqual(["Second Developer", "Canal PC"]);
    await expect(reorderHomepageCompanyLogos(admin.principal, admin.user.id, { ids: [item.id] })).rejects.toMatchObject({ code: "HOMEPAGE_RAIL_CHANGED" });

    await deleteHomepageCompanyLogo(admin.principal, item.id);
    expect((await listPublicHomepageCompanies()).map((entry) => entry.displayName)).toEqual(["Second Developer"]);

    const actions = (await db.platformAuditEvent.findMany({ where: { action: { startsWith: "homepage_company." } }, orderBy: { createdAt: "asc" } })).map((event) => event.action);
    expect(actions).toEqual([
      "homepage_company.added",
      "homepage_company.unpublished",
      "homepage_company.published",
      "homepage_company.added",
      "homepage_company.reordered",
      "homepage_company.removed",
    ]);
  });

  it("rejects PENDING, suspended-account, archived and non-company profiles", async () => {
    const admin = await makeAdmin();
    const pending = await makeCompany("Pending Co");
    await submitMarketplaceVerification(pending.owner.id, pending.professional.id, { evidenceReferences: ["doc"] });
    const suspended = await makeCompany("Suspended Co");
    await reviewMarketplaceVerification(admin.user, suspended.professional.id, { status: "VERIFIED" });
    await setMarketplaceProfessionalAccountStatus(admin.user, suspended.professional.id, { status: "SUSPENDED", reason: "Review" });
    const archived = await makeCompany("Archived Co");
    await db.marketplaceProfessional.update({ where: { id: archived.professional.id }, data: { verificationStatus: "VERIFIED", archivedAt: new Date() } });

    for (const id of [pending.professional.id, suspended.professional.id, archived.professional.id]) {
      await expect(createHomepageCompanyLogo(admin.principal, admin.user.id, { marketplaceProfessionalId: id, isPublished: true }))
        .rejects.toThrow("Only active, verified marketplace companies can be featured on the homepage.");
    }

    for (const type of ["INDIVIDUAL_AGENT", "BROKER", "OTHER"]) {
      const { professional } = await makeCompany(`Verified ${type}`, type);
      await reviewMarketplaceVerification(admin.user, professional.id, { status: "VERIFIED" });
      await expect(createHomepageCompanyLogo(admin.principal, admin.user.id, { marketplaceProfessionalId: professional.id, isPublished: true }))
        .rejects.toMatchObject({ code: "HOMEPAGE_COMPANY_INELIGIBLE" });
      const media = await listHomepageMediaForPlatform(admin.principal);
      expect(media.candidates.map((entry) => entry.id)).not.toContain(professional.id);
    }
  });

  it("an item whose company becomes ineligible leaves the public rail, can be unpublished and removed, but not re-published", async () => {
    const admin = await makeAdmin();
    const { professional } = await makeCompany("Fallen Co");
    await reviewMarketplaceVerification(admin.user, professional.id, { status: "VERIFIED" });
    const item = await createHomepageCompanyLogo(admin.principal, admin.user.id, { marketplaceProfessionalId: professional.id, isPublished: true });

    await setMarketplaceProfessionalAccountStatus(admin.user, professional.id, { status: "SUSPENDED", reason: "Investigation" });
    expect(await listPublicHomepageCompanies()).toEqual([]);

    await updateHomepageCompanyLogo(admin.principal, admin.user.id, item.id, { isPublished: false });
    await expect(updateHomepageCompanyLogo(admin.principal, admin.user.id, item.id, { isPublished: true })).rejects.toMatchObject({ code: "HOMEPAGE_COMPANY_INELIGIBLE" });

    await setMarketplaceProfessionalAccountStatus(admin.user, professional.id, { status: "ACTIVE" });
    await updateHomepageCompanyLogo(admin.principal, admin.user.id, item.id, { isPublished: true });
    expect(await listPublicHomepageCompanies()).toHaveLength(1);

    await deleteHomepageCompanyLogo(admin.principal, item.id);
    await expect(deleteHomepageCompanyLogo(admin.principal, item.id)).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("denies homepage mutations to roles without homepage permission", async () => {
    const support = await makeAdmin("SUPPORT_AGENT");
    const { professional } = await makeCompany("Support Co");
    await expect(createHomepageCompanyLogo(support.principal, support.user.id, { marketplaceProfessionalId: professional.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(reorderHomepageCompanyLogos(support.principal, support.user.id, { ids: [] })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
