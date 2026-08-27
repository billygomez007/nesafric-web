import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/platform/database/client";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { createProperty } from "@/modules/assets/service";
import { createListing } from "@/modules/listings/service";
import {
  createMarketplaceProfessional,
  getMarketplaceProfessional,
  updateMarketplaceProfessional,
  addMarketplaceMember,
  updateMarketplaceMember,
  submitMarketplaceVerification,
  reviewMarketplaceVerification,
  changeMarketplacePlan,
  getPublicMarketplaceProfessionalProfile,
  listUserMarketplaceProfessionals,
  listUserWorkspaces,
} from "@/modules/marketplace-professionals/service";
import { createDevelopment, createDevelopmentUnit, listDevelopments } from "@/modules/developments/service";
import { listUserOrganisations } from "@/modules/organisations/service";

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner" CASCADE');
  await db.tenant.deleteMany();
  // Plans created within a test (e.g. simulating a future paid tier) are not tied to any
  // Organisation/User row, so TRUNCATE CASCADE above never reaches them — clean up everything
  // except the seeded free plan so this file is safely rerunnable.
  await db.marketplacePlan.deleteMany({ where: { key: { notIn: ["marketplace_free", "marketplace_pro", "marketplace_brokerage", "marketplace_enterprise"] } } });
}

async function addMember(organisationId: string, userId: string, roleKey: string) {
  const role = await db.role.findUniqueOrThrow({ where: { key: roleKey } });
  const member = await db.organisationMember.create({ data: { organisationId, userId } });
  await db.membershipRole.create({ data: { memberId: member.id, roleId: role.id } });
  return member;
}

const baseListing = (propertyId: string, overrides: Record<string, unknown> = {}) => ({
  propertyId,
  listingType: "RENT" as const,
  category: "apartment",
  title: "Bright two-bedroom home",
  publicDescription: "A bright, well-maintained home with flexible viewing availability.",
  rentAmountMinor: "250000",
  currencyCode: "GHS",
  frequency: "MONTHLY" as const,
  availableFrom: "2026-09-01",
  countryCode: "GH",
  region: "Greater Accra",
  city: "Accra",
  ...overrides,
});

describe("PostgreSQL Phase 21A marketplace professionals", () => {
  beforeEach(cleanDatabase);
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("creates an individual agent profile with a hidden backing organisation, free marketplace subscription, and no PropertyOS subscription", async () => {
    const owner = await registerUser({ displayName: "Ama Agent", email: "ama-agent@example.com", password: "secure-password-123" });
    const professional = await createMarketplaceProfessional(owner.id, {
      type: "INDIVIDUAL_AGENT", displayName: "Ama Agent Realty", countryCode: "GH",
      specialities: ["Residential"], servicesOffered: ["Sales", "Rentals"], serviceAreas: ["Accra"],
    });
    expect(professional.type).toBe("INDIVIDUAL_AGENT");
    expect(professional.verificationStatus).toBe("UNVERIFIED");
    expect(professional.slug).toBeTruthy();

    // No PropertyOS management subscription ever attached to the backing organisation (item 8).
    const orgSubscription = await db.organisationSubscription.findUnique({ where: { organisationId: professional.backingOrganisationId } });
    expect(orgSubscription).toBeNull();

    // A separate, free marketplace subscription exists instead.
    const marketplaceSubscription = await db.marketplaceSubscription.findUniqueOrThrow({ where: { marketplaceProfessionalId: professional.id }, include: { plan: true } });
    expect(marketplaceSubscription.status).toBe("ACTIVE");
    expect(marketplaceSubscription.plan.key).toBe("marketplace_free");
    const price = await db.marketplacePlanPrice.findFirstOrThrow({ where: { planId: marketplaceSubscription.planId } });
    expect(price.amountMinor.toString()).toBe("0");

    // The creator is the OWNER team member.
    const member = await db.marketplaceProfessionalMember.findUniqueOrThrow({ where: { marketplaceProfessionalId_userId: { marketplaceProfessionalId: professional.id, userId: owner.id } } });
    expect(member.role).toBe("OWNER");

    // Audit event recorded, scoped to the backing organisation.
    const audit = await db.auditEvent.findFirst({ where: { organisationId: professional.backingOrganisationId, action: "marketplace_professional.created", entityId: professional.id } });
    expect(audit).toBeTruthy();
  });

  it("creates a brokerage/company profile with a team, enforces RBAC, and protects the last owner", async () => {
    const owner = await registerUser({ displayName: "Kwame Owner", email: "kwame-owner@example.com", password: "secure-password-123" });
    const agentUser = await registerUser({ displayName: "Yaw Agent", email: "yaw-agent@example.com", password: "secure-password-123" });
    const outsider = await registerUser({ displayName: "Outsider", email: "brokerage-outsider@example.com", password: "secure-password-123" });

    const brokerage = await createMarketplaceProfessional(owner.id, { type: "BROKERAGE", displayName: "Golden Coast Brokerage", countryCode: "GH" });

    const member = await addMarketplaceMember(owner.id, brokerage.id, { email: "yaw-agent@example.com", role: "AGENT" });
    expect(member.role).toBe("AGENT");

    // RBAC: an AGENT cannot add another member.
    await expect(addMarketplaceMember(agentUser.id, brokerage.id, { email: "brokerage-outsider@example.com", role: "AGENT" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // RBAC: a non-member cannot read the profile.
    await expect(getMarketplaceProfessional(outsider.id, brokerage.id)).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Promote the agent to ADMIN; ADMIN can update the profile but not change the plan (OWNER only).
    await updateMarketplaceMember(owner.id, brokerage.id, member.id, { role: "ADMIN" });
    await expect(updateMarketplaceProfessional(agentUser.id, brokerage.id, { description: "Updated by admin." })).resolves.toMatchObject({ description: "Updated by admin." });
    await expect(changeMarketplacePlan(agentUser.id, brokerage.id, { planKey: "marketplace_free" })).rejects.toMatchObject({ code: "FORBIDDEN" });

    // The sole OWNER cannot be demoted/removed once they are the last owner.
    const ownerMember = await db.marketplaceProfessionalMember.findUniqueOrThrow({ where: { marketplaceProfessionalId_userId: { marketplaceProfessionalId: brokerage.id, userId: owner.id } } });
    await expect(updateMarketplaceMember(owner.id, brokerage.id, ownerMember.id, { role: "ADMIN" })).rejects.toMatchObject({ code: "LAST_OWNER" });

    const detail = await getMarketplaceProfessional(owner.id, brokerage.id);
    expect(detail.members).toHaveLength(2);
  });

  it("supports a developer profile with a development/project and inventory, and enforces the developments-per-plan limit", async () => {
    const developer = await registerUser({ displayName: "Ridge Developments", email: "ridge-dev@example.com", password: "secure-password-123" });
    const professional = await createMarketplaceProfessional(developer.id, { type: "DEVELOPER", displayName: "Ridge Developments Ltd", countryCode: "GH" });

    const development = await createDevelopment(developer.id, professional.id, {
      name: "Ridge Gardens Phase 1", countryCode: "GH", city: "Accra", amenities: ["Pool", "Gym"],
    });
    expect(development.status).toBe("PLANNING");

    const unit = await createDevelopmentUnit(developer.id, professional.id, development.id, {
      name: "Block A - Unit 12", unitType: "2-bedroom", bedrooms: 2, bathrooms: 2, priceMinor: "85000000", currencyCode: "GHS",
    });
    expect(unit.status).toBe("AVAILABLE");

    const developments = await listDevelopments(developer.id, professional.id);
    expect(developments).toHaveLength(1);
    expect(developments[0]._count.units).toBe(1);

    // Free plan allows 2 developments.
    await createDevelopment(developer.id, professional.id, { name: "Ridge Gardens Phase 2", countryCode: "GH" });
    await expect(createDevelopment(developer.id, professional.id, { name: "Ridge Gardens Phase 3", countryCode: "GH" }))
      .rejects.toMatchObject({ code: "MARKETPLACE_ENTITLEMENT_LIMIT_REACHED", details: { feature: "marketplace.developments.max", current: 2, limit: 2 } });
  });

  it("supports a third-party listing relationship (a brokerage marketing a landlord's property) with an attributed representative, and landlord self-listing readiness", async () => {
    const landlord = await registerUser({ displayName: "Landlord Owner", email: "landlord-owner@example.com", password: "secure-password-123" });
    const brokerOwner = await registerUser({ displayName: "Broker Owner", email: "broker-owner@example.com", password: "secure-password-123" });
    const agent = await registerUser({ displayName: "Rep Agent", email: "rep-agent@example.com", password: "secure-password-123" });

    const landlordOrg = await createOrganisation(landlord.id, { name: "Landlord Portfolio", type: "INDIVIDUAL_LANDLORD", countryCode: "GH" });
    const property = await createProperty(landlord.id, landlordOrg.id, { name: "Osu House", referenceNumber: "OSU-1", category: "Residential", countryCode: "GH", currencyCode: "GHS" });

    const brokerage = await createMarketplaceProfessional(brokerOwner.id, { type: "BROKERAGE", displayName: "City Brokers", countryCode: "GH" });
    await addMarketplaceMember(brokerOwner.id, brokerage.id, { email: "rep-agent@example.com", role: "AGENT" });
    // The landlord grants the brokerage's agent PropertyOS listing access on their own organisation.
    await addMember(landlordOrg.id, agent.id, "property_manager");

    const listing = await createListing(agent.id, landlordOrg.id, baseListing(property.id, {
      marketplaceProfessionalId: brokerage.id,
      listingRepresentativeUserId: agent.id,
      listingAuthority: "BROKERAGE_AUTHORIZED",
    }));
    expect(listing.marketplaceProfessionalId).toBe(brokerage.id);
    expect(listing.listingRepresentativeUserId).toBe(agent.id);
    expect(listing.listingAuthority).toBe("BROKERAGE_AUTHORIZED");
    // The underlying PropertyOS organisation/property attribution is completely unchanged — the
    // brokerage never owns or manages the property, it only markets it (item 4).
    expect(listing.organisationId).toBe(landlordOrg.id);

    // A user with PropertyOS listing access but no membership in the brokerage cannot attribute a
    // listing to it (item 5/11).
    const randomAgent = await registerUser({ displayName: "Unaffiliated", email: "unaffiliated-agent@example.com", password: "secure-password-123" });
    await addMember(landlordOrg.id, randomAgent.id, "property_manager");
    await expect(createListing(randomAgent.id, landlordOrg.id, baseListing(property.id, { marketplaceProfessionalId: brokerage.id })))
      .rejects.toMatchObject({ code: "FORBIDDEN" });

    // Landlord self-listing readiness: the landlord lists their own property with no marketplace
    // professional at all — completely unaffected by this phase's additions.
    const selfListing = await createListing(landlord.id, landlordOrg.id, baseListing(property.id, { listingAuthority: "OWNER_SELF" }));
    expect(selfListing.marketplaceProfessionalId).toBeNull();
    expect(selfListing.listingAuthority).toBe("OWNER_SELF");
  });

  it("supports developer inventory published as a full listing, and a dual-workspace user (one identity, a PropertyOS organisation and a Marketplace professional)", async () => {
    const developer = await registerUser({ displayName: "Dual Workspace Developer", email: "dual-dev@example.com", password: "secure-password-123" });

    // The developer subscribes to PropertyOS to manage its own completed inventory...
    const propertyOsOrg = await createOrganisation(developer.id, { name: "Ridge Developments PropertyOS", type: "DEVELOPER", countryCode: "GH" });
    const property = await createProperty(developer.id, propertyOsOrg.id, { name: "Ridge Gardens Block A", referenceNumber: "RGA-1", category: "Residential", countryCode: "GH", currencyCode: "GHS" });

    // ...AND separately operates a marketplace professional/developer profile to sell units (item 7).
    const professional = await createMarketplaceProfessional(developer.id, { type: "DEVELOPER", displayName: "Ridge Developments", countryCode: "GH" });
    const development = await createDevelopment(developer.id, professional.id, { name: "Ridge Gardens", countryCode: "GH" });
    const unit = await createDevelopmentUnit(developer.id, professional.id, development.id, { name: "Unit 12", priceMinor: "85000000", currencyCode: "GHS" });

    const listing = await createListing(developer.id, propertyOsOrg.id, baseListing(property.id, {
      listingType: "SALE", rentAmountMinor: undefined, frequency: undefined, askingAmountMinor: "85000000",
      marketplaceProfessionalId: professional.id, developmentId: development.id, developmentUnitId: unit.id, listingAuthority: "DEVELOPER",
    }));
    expect(listing.developmentId).toBe(development.id);
    expect(listing.developmentUnitId).toBe(unit.id);

    // ONE user identity -> one or more PropertyOS organisations AND one or more marketplace
    // professionals, kept as two clearly separate collections (item 7).
    const workspaces = await listUserWorkspaces(developer.id);
    expect(workspaces.propertyOsOrganisations.map((o) => o.id)).toEqual([propertyOsOrg.id]);
    expect(workspaces.marketplaceProfessionals.map((p) => p.id)).toEqual([professional.id]);
  });

  it("never grants PropertyOS management access merely because an account has a marketplace profile, and keeps subscriptions separate", async () => {
    const agent = await registerUser({ displayName: "Marketplace Only Agent", email: "marketplace-only@example.com", password: "secure-password-123" });
    const professional = await createMarketplaceProfessional(agent.id, { type: "INDIVIDUAL_AGENT", displayName: "Solo Agent", countryCode: "GH" });

    // The user IS technically an OrganisationMember of the hidden backing organisation, but the
    // PropertyOS-facing organisation listing must never surface it (item 6/11).
    const backingMembership = await db.organisationMember.findFirst({ where: { organisationId: professional.backingOrganisationId, userId: agent.id } });
    expect(backingMembership).toBeTruthy();
    expect(await listUserOrganisations(agent.id)).toEqual([]);

    // The two commercial tracks never overlap.
    expect(await db.organisationSubscription.findUnique({ where: { organisationId: professional.backingOrganisationId } })).toBeNull();
    expect(await db.marketplaceSubscription.findUnique({ where: { marketplaceProfessionalId: professional.id } })).toBeTruthy();
  });

  it("keeps two marketplace professionals fully isolated from each other", async () => {
    const ownerA = await registerUser({ displayName: "Owner A", email: "iso-owner-a@example.com", password: "secure-password-123" });
    const ownerB = await registerUser({ displayName: "Owner B", email: "iso-owner-b@example.com", password: "secure-password-123" });
    const professionalA = await createMarketplaceProfessional(ownerA.id, { type: "BROKER", displayName: "Broker A", countryCode: "GH" });
    const professionalB = await createMarketplaceProfessional(ownerB.id, { type: "BROKER", displayName: "Broker B", countryCode: "GH" });

    await expect(getMarketplaceProfessional(ownerB.id, professionalA.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateMarketplaceProfessional(ownerB.id, professionalA.id, { description: "hijacked" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(addMarketplaceMember(ownerB.id, professionalA.id, { email: "iso-owner-b@example.com", role: "AGENT" })).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect((await listUserMarketplaceProfessionals(ownerA.id)).map((p) => p.id)).toEqual([professionalA.id]);
    expect((await listUserMarketplaceProfessionals(ownerB.id)).map((p) => p.id)).toEqual([professionalB.id]);
  });

  it("verifies a profile through platform administration, exposes a safe public projection, and records audit history", async () => {
    const owner = await registerUser({ displayName: "Verified Owner", email: "verified-owner@example.com", password: "secure-password-123" });
    const platformAdminUser = await registerUser({ displayName: "Platform Admin", email: "phase21a-platform-admin@example.com", password: "secure-password-123" });
    await db.platformPrincipal.create({ data: { userId: platformAdminUser.id, role: "SUPER_ADMIN", status: "ACTIVE", createdVia: "MANUAL" } });

    const professional = await createMarketplaceProfessional(owner.id, {
      type: "REAL_ESTATE_COMPANY", displayName: "Premier Real Estate", countryCode: "GH", contactEmail: "hello@premier.example",
    });

    await submitMarketplaceVerification(owner.id, professional.id, { evidenceReferences: ["private/evidence/business-registration.pdf"] });
    expect((await getMarketplaceProfessional(owner.id, professional.id)).verificationStatus).toBe("PENDING");

    const reviewed = await reviewMarketplaceVerification(platformAdminUser, professional.id, { status: "VERIFIED", reason: "Business registration confirmed." });
    expect(reviewed.verificationStatus).toBe("VERIFIED");

    const history = await db.marketplaceProfessionalVerificationEvent.findMany({ where: { marketplaceProfessionalId: professional.id }, orderBy: { createdAt: "asc" } });
    expect(history.map((entry) => entry.toStatus)).toEqual(["PENDING", "VERIFIED"]);
    expect(history[1].actorUserId).toBe(platformAdminUser.id);

    // Safe public projection: no private evidence references, no member emails/ids, no backing
    // organisation or creator identity (item 11).
    const publicProfile = await getPublicMarketplaceProfessionalProfile(professional.slug);
    expect(publicProfile.displayName).toBe("Premier Real Estate");
    expect(publicProfile.verificationStatus).toBe("VERIFIED");
    expect(publicProfile).not.toHaveProperty("verificationEvidenceReferences");
    expect(publicProfile).not.toHaveProperty("backingOrganisationId");
    expect(publicProfile).not.toHaveProperty("createdByUserId");
    expect(publicProfile.members[0]).not.toHaveProperty("userId");
    expect(publicProfile.members[0]).not.toHaveProperty("email");
    expect(publicProfile.members[0].user.displayName).toBe("Verified Owner");

    // A non-platform-admin cannot review verification.
    await expect(reviewMarketplaceVerification(owner, professional.id, { status: "VERIFIED" })).rejects.toMatchObject({ code: "FORBIDDEN" });

    const createdAudit = await db.auditEvent.findFirst({ where: { organisationId: professional.backingOrganisationId, action: "marketplace_professional.created" } });
    expect(createdAudit?.actorUserId).toBe(owner.id);
  });

  it("supports future paid-plan readiness without a schema change", async () => {
    const owner = await registerUser({ displayName: "Future Plan Owner", email: "future-plan-owner@example.com", password: "secure-password-123" });
    const professional = await createMarketplaceProfessional(owner.id, { type: "BROKERAGE", displayName: "Growth Brokerage", countryCode: "GH" });

    // Simulates a future platform-admin action introducing a real paid tier (item 8: "do not
    // hard-code marketplace professionals never pay") — no migration required for this.
    const proPlan = await db.marketplacePlan.create({
      data: {
        key: "marketplace_professional_tier", name: "Marketplace Professional", isActive: true, isPublic: true, sortOrder: 2,
        prices: { create: [{ currencyCode: "GHS", billingCycle: "MONTHLY", amountMinor: "15000" }] },
        entitlements: { create: [{ featureKey: "marketplace.listings.active_max", kind: "LIMIT", limitValue: 100 }] },
      },
    });

    const updated = await changeMarketplacePlan(owner.id, professional.id, { planKey: proPlan.key });
    expect(updated.planId).toBe(proPlan.id);
    const price = await db.marketplacePlanPrice.findFirstOrThrow({ where: { planId: proPlan.id } });
    expect(price.amountMinor.toString()).toBe("15000");
  });
});
