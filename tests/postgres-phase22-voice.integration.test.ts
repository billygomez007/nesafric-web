import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/platform/database/client";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { createProperty } from "@/modules/assets/service";
import { createMarketplaceNativeListing, updateListingVerification, transitionListing } from "@/modules/listings/service";
import { createMaintenanceRequest, createWorkOrder, transitionMaintenanceRequest } from "@/modules/maintenance/service";
import { proposeDispatch } from "@/modules/maintenance-dispatch/service";
import { createServiceProvider, addProviderToDirectory } from "@/modules/providers/service";
import { createMarketplaceProfessional, changeMarketplacePlan } from "@/modules/marketplace-professionals/service";
import { createMarketplaceAIEmployee } from "@/modules/marketplace-ai/service";
import { createAIEmployee } from "@/modules/ai-employees/service";
import { updateAutonomyConfiguration, upsertAutonomyPolicy } from "@/modules/ai-autonomy/service";
import { createTenant } from "@/modules/tenants/service";
import { createDevelopment, createDevelopmentUnit } from "@/modules/developments/service";
import { signMockVoiceWebhook } from "@/modules/voice/provider";
import {
  configureVoiceProvider,
  startInboundCall,
  answerListingEnquiry,
  searchCallInventory,
  captureVoiceLead,
  scheduleVoiceViewing,
  verifyVoiceCallerIdentity,
  getTenantCallSummary,
  intakeMaintenanceByVoice,
  requestVoiceHandoff,
  proposeAndCallArtisan,
  placeOutboundArtisanCall,
  recordArtisanCallResponse,
  placeOutboundProspectCall,
  placeOutboundTenantCall,
  setVoiceContactPreference,
  ingestProviderWebhook,
  listVoiceCalls,
  getVoiceCall,
  getVoiceAnalytics,
} from "@/modules/voice/service";

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner" CASCADE');
  await db.tenant.deleteMany();
  await db.marketplacePlan.deleteMany({ where: { key: { notIn: ["marketplace_free", "marketplace_pro", "marketplace_brokerage", "marketplace_enterprise"] } } });
}

function scalePropertyOsOrg(organisationId: string) {
  return db.organisationSubscription.update({ where: { organisationId }, data: { plan: { connect: { key: "scale" } } } });
}

async function createNativeListing(userId: string, marketplaceProfessionalId: string, overrides: Record<string, unknown> = {}) {
  return createMarketplaceNativeListing(userId, marketplaceProfessionalId, {
    asset: {
      name: "Bright two-bedroom apartment in East Legon", category: "apartment", purpose: "RENT",
      bedrooms: 2, bathrooms: 2, currencyCode: "GHS", priceMinor: "250000", countryCode: "GH",
      region: "Greater Accra", city: "East Legon", availableFrom: "2026-09-01",
    },
    listing: {
      listingType: "RENT", category: "apartment", title: "Bright two-bedroom apartment in East Legon",
      publicDescription: "A bright, well-maintained two-bedroom apartment with flexible viewing availability.",
      currencyCode: "GHS", frequency: "MONTHLY", availableFrom: "2026-09-01", countryCode: "GH",
      media: [{ type: "PHOTO", publicUrl: "https://cdn.example.com/listing/photo.jpg" }],
    },
    listingAuthority: "OWNER_SELF",
    ...overrides,
  });
}

async function publishListing(userId: string, organisationId: string, listingId: string) {
  await updateListingVerification(userId, organisationId, listingId, {
    status: "PENDING", evidence: [{ type: "OWNERSHIP_OR_AUTHORITY", privateReference: "private/evidence/title-deed.pdf" }],
  });
  await updateListingVerification(userId, organisationId, listingId, { status: "VERIFIED", note: "Authority checked." });
  await transitionListing(userId, organisationId, listingId, { status: "PENDING_REVIEW" });
  return transitionListing(userId, organisationId, listingId, { status: "PUBLISHED" });
}

const wideHours = { businessHoursStart: "00:00", businessHoursEnd: "23:59" };

describe("PostgreSQL Phase 22 AI voice", () => {
  beforeEach(cleanDatabase);
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("routes an inbound marketplace call to the AI Sales Receptionist, answers a live listing enquiry, captures a lead, and schedules a viewing", async () => {
    const owner = await registerUser({ displayName: "Voice Brokerage Owner", email: "voice-brokerage-owner@example.com", password: "secure-password-123" });
    const brokerage = await createMarketplaceProfessional(owner.id, { type: "BROKERAGE", displayName: "Voice Brokerage", countryCode: "GH" });
    await changeMarketplacePlan(owner.id, brokerage.id, { planKey: "marketplace_brokerage" });
    await configureVoiceProvider(owner.id, brokerage.backingOrganisationId, { phoneNumber: "+233200000010", inboundEnabled: true, outboundEnabled: true, ...wideHours });
    await createMarketplaceAIEmployee(owner.id, brokerage.id, { name: "Ama", role: "AI_SALES_RECEPTIONIST", instructions: {}, escalationConfiguration: {} });
    const salesAgent = await createMarketplaceAIEmployee(owner.id, brokerage.id, { name: "Kwame", role: "AI_SALES_AGENT", instructions: {}, escalationConfiguration: {} });
    void salesAgent;

    const listing = await createNativeListing(owner.id, brokerage.id);
    await publishListing(owner.id, brokerage.backingOrganisationId, listing.id);

    const { call, routing } = await startInboundCall({ toNumber: "+233200000010", fromNumber: "+233240000099", listingId: listing.id });
    expect(routing?.requiresHandoff).toBe(false);
    expect(call.direction).toBe("INBOUND");
    expect(call.aiEmployeeId).toBeTruthy();

    const enquiry = await answerListingEnquiry(call.id, { listingId: listing.id });
    expect(enquiry.found).toBe(true);
    expect(enquiry.available).toBe(true);

    const lead = await captureVoiceLead(call.id, { listingId: listing.id, name: "Efua Prospect", phone: "+233240000099" });
    expect(lead.id).toBeTruthy();

    const viewing = await scheduleVoiceViewing(call.id, {
      leadId: lead.id, listingId: listing.id,
      startsAt: new Date(Date.now() + 24 * 60 * 60 * 1000), endsAt: new Date(Date.now() + 24 * 60 * 60 * 1000 + 30 * 60 * 1000),
    });
    expect(viewing.id).toBeTruthy();

    const finalCall = await db.voiceCall.findUniqueOrThrow({ where: { id: call.id } });
    expect(finalCall.outcome).toBe("VIEWING_SCHEDULED");
    expect(finalCall.transcriptText).toContain("Captured prospect");
  });

  it("searches live inventory conversationally, recommends alternatives when a listing is unavailable, and answers a developer-inventory call scoped to one development", async () => {
    const owner = await registerUser({ displayName: "Inventory Owner", email: "voice-inventory-owner@example.com", password: "secure-password-123" });
    const developer = await createMarketplaceProfessional(owner.id, { type: "DEVELOPER", displayName: "Voice Developer", countryCode: "GH" });
    await changeMarketplacePlan(owner.id, developer.id, { planKey: "marketplace_pro" });
    await configureVoiceProvider(owner.id, developer.backingOrganisationId, { phoneNumber: "+233200000011", inboundEnabled: true, ...wideHours });

    const development = await createDevelopment(owner.id, developer.id, { name: "Ridge Gardens", countryCode: "GH" });
    const unit = await createDevelopmentUnit(owner.id, developer.id, development.id, { name: "Block A - Unit 3B", unitType: "3-bedroom", bedrooms: 3, priceMinor: "1900000000", currencyCode: "GHS" });
    const devListing = await createNativeListing(owner.id, developer.id, {
      listing: { listingType: "SALE", category: "apartment", title: "Ridge Gardens 3-bed", publicDescription: "A three-bedroom unit in Ridge Gardens with flexible viewing availability.", currencyCode: "GHS", askingAmountMinor: "1900000000", availableFrom: "2026-09-01", countryCode: "GH", bedrooms: 3, media: [{ type: "PHOTO", publicUrl: "https://cdn.example.com/listing/photo.jpg" }] },
      asset: { developmentUnitId: unit.id, name: "Ridge Gardens 3-bed", category: "apartment", purpose: "SALE", bedrooms: 3, currencyCode: "GHS", priceMinor: "1900000000", countryCode: "GH", availableFrom: "2026-09-01" },
    });
    await publishListing(owner.id, developer.backingOrganisationId, devListing.id);
    const pausedListing = await createNativeListing(owner.id, developer.id, { listing: { listingType: "RENT", category: "apartment", title: "Unavailable East Legon Unit", publicDescription: "A bright, well-maintained two-bedroom apartment with flexible viewing availability.", currencyCode: "GHS", frequency: "MONTHLY", availableFrom: "2026-09-01", countryCode: "GH", city: "East Legon", media: [{ type: "PHOTO", publicUrl: "https://cdn.example.com/listing/photo.jpg" }] } });
    await publishListing(owner.id, developer.backingOrganisationId, pausedListing.id);
    await transitionListing(owner.id, developer.backingOrganisationId, pausedListing.id, { status: "PAUSED" });

    const { call } = await startInboundCall({ toNumber: "+233200000011", fromNumber: "+233240000098" });

    const results = await searchCallInventory(call.id, { purpose: "SALE", bedrooms: 3, developmentId: development.id });
    expect(results).toHaveLength(1);
    expect(results[0].development).toBe("Ridge Gardens");

    const unavailable = await answerListingEnquiry(call.id, { listingId: pausedListing.id });
    expect(unavailable.available).toBe(false);
    expect(unavailable).toHaveProperty("alternatives");
  });

  it("verifies a tenant caller's identity before exposing lease/payment data, and denies an unverified caller private information", async () => {
    const owner = await registerUser({ displayName: "Voice Tenant Landlord", email: "voice-tenant-landlord@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Voice Tenant Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await scalePropertyOsOrg(organisation.id);
    await configureVoiceProvider(owner.id, organisation.id, { phoneNumber: "+233200000012", inboundEnabled: true, ...wideHours });
    await updateAutonomyConfiguration(owner.id, organisation.id, { enabled: true, defaultLevel: "RECOMMEND_ONLY", communicationAllowed: true });
    await createAIEmployee(owner.id, organisation.id, { name: "Ama Receptionist", role: "RECEPTIONIST", scope: "ORGANISATION", toolPermissions: ["tenants.history", "listings.availability_check"], instructions: {}, escalationConfiguration: {} });

    const property = await createProperty(owner.id, organisation.id, { name: "Voice Tenant House", referenceNumber: "VTH-1", category: "Residential", countryCode: "GH", currencyCode: "GHS" });
    await createTenant(owner.id, organisation.id, { legalName: "Voice Tenant", email: "voice-tenant@example.com", phone: "+233240000097" });
    void property;

    const { call } = await startInboundCall({ toNumber: "+233200000012", fromNumber: "+233240000097" });

    await expect(getTenantCallSummary(call.id)).rejects.toMatchObject({ code: "FORBIDDEN" });

    const wrongEmail = await verifyVoiceCallerIdentity(call.id, { phone: "+233240000097", email: "wrong@example.com" });
    expect(wrongEmail.level).toBe("CLAIMED");
    await expect(getTenantCallSummary(call.id)).rejects.toMatchObject({ code: "FORBIDDEN" });

    const verified = await verifyVoiceCallerIdentity(call.id, { phone: "+233240000097", email: "voice-tenant@example.com" });
    expect(verified.level).toBe("VERIFIED");
    const summary = await getTenantCallSummary(call.id);
    expect(summary).toHaveProperty("leases");
  });

  it("intakes a maintenance report by voice for AC, electrical, and plumbing categories, creating a real maintenance request each time", async () => {
    const owner = await registerUser({ displayName: "Voice Maintenance Landlord", email: "voice-maintenance-landlord@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Voice Maintenance Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await scalePropertyOsOrg(organisation.id);
    await configureVoiceProvider(owner.id, organisation.id, { phoneNumber: "+233200000013", inboundEnabled: true, ...wideHours });
    await updateAutonomyConfiguration(owner.id, organisation.id, { enabled: true, defaultLevel: "RECOMMEND_ONLY", communicationAllowed: true });
    const property = await createProperty(owner.id, organisation.id, { name: "Voice Maintenance House", referenceNumber: "VMH-1", category: "Residential", countryCode: "GH", currencyCode: "GHS" });
    const policy = await upsertAutonomyPolicy(owner.id, organisation.id, { actionKey: "maintenance.create", enabled: true, level: "APPROVAL_REQUIRED", propertyId: property.id, timezone: "UTC" });
    await createAIEmployee(owner.id, organisation.id, { name: "Ama Receptionist", role: "RECEPTIONIST", scope: "ORGANISATION", toolPermissions: ["maintenance.create"], autonomyPolicyIds: [policy.id], instructions: {}, escalationConfiguration: {} });

    for (const category of ["air conditioning", "electrical", "plumbing"]) {
      const { call } = await startInboundCall({ toNumber: "+233200000013", fromNumber: `+23324000${category.length}001` });
      const result = await intakeMaintenanceByVoice(call.id, {
        propertyId: property.id, title: `${category} issue`, description: `Caller reported a ${category} problem over the phone.`,
        category, priority: "NORMAL", idempotencyKey: `voice-${category}-${call.id}`,
      });
      // Reports queue as proposals for operator approval (item 13's "approval requirements" must
      // never be bypassed by voice) — the request itself is created once a human approves it.
      expect(result).toMatchObject({ type: "PROPOSAL", status: "PENDING", actionKey: "maintenance.create" });
      const updatedCall = await db.voiceCall.findUniqueOrThrow({ where: { id: call.id } });
      expect(updatedCall.outcome).toBe("MAINTENANCE_REQUEST_CREATED");
    }
  });

  it("dispatches an outbound artisan call through the existing provider hierarchy — preferred provider accepts, then a second work order's preferred provider declines and escalates to backup — without creating a call loop", async () => {
    const owner = await registerUser({ displayName: "Voice Dispatch Landlord", email: "voice-dispatch-landlord@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Voice Dispatch Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await scalePropertyOsOrg(organisation.id);
    await configureVoiceProvider(owner.id, organisation.id, { phoneNumber: "+233200000014", outboundEnabled: true, ...wideHours });
    const property = await createProperty(owner.id, organisation.id, { name: "Voice Dispatch House", referenceNumber: "VDH-1", category: "Residential", countryCode: "GH", currencyCode: "GHS" });
    const plumbingCategory = await db.serviceCategory.findUniqueOrThrow({ where: { key: "plumbing" } });

    async function verifiedProvider(email: string, displayName: string, phone: string) {
      const user = await registerUser({ displayName, email, password: "secure-password-123" });
      const provider = await createServiceProvider(user.id, { type: "INDIVIDUAL", displayName, contactEmail: email, categoryIds: [plumbingCategory.id] });
      await db.serviceProvider.update({ where: { id: provider.id }, data: { verificationStatus: "VERIFIED", acceptingWork: true, availabilityStatus: "AVAILABLE", contactPhone: phone } });
      return provider;
    }
    const preferred = await verifiedProvider("voice-preferred-plumber@example.com", "Preferred Plumber", "+233240000010");
    const backup = await verifiedProvider("voice-backup-plumber@example.com", "Backup Plumber", "+233240000011");
    await addProviderToDirectory(owner.id, organisation.id, { providerId: preferred.id });
    await db.providerOrganisation.updateMany({ where: { providerId: preferred.id }, data: { priority: 10 } });
    await addProviderToDirectory(owner.id, organisation.id, { providerId: backup.id });
    await db.providerOrganisation.updateMany({ where: { providerId: backup.id }, data: { isBackup: true } });

    const request = await createMaintenanceRequest(owner.id, organisation.id, { propertyId: property.id, title: "Leaking pipe", description: "Kitchen pipe is leaking.", category: "plumbing" });
    await transitionMaintenanceRequest(owner.id, organisation.id, request.id, { status: "TRIAGED" });
    const workOrder = await createWorkOrder(owner.id, organisation.id, request.id, { title: "Fix leaking pipe", currencyCode: "GHS" });

    const call = await proposeAndCallArtisan(owner.id, organisation.id, { workOrderId: workOrder.id });
    expect(call.status).toBe("IN_PROGRESS");
    expect(call.toNumber).toBe("+233240000010");

    const accepted = await recordArtisanCallResponse(owner.id, organisation.id, call.id, { response: "AVAILABLE" });
    expect(accepted.outcome).toBe("ARTISAN_ACCEPTED");
    expect(accepted.status).toBe("COMPLETED");
    expect((await db.workOrder.findUniqueOrThrow({ where: { id: workOrder.id } })).status).toBe("ASSIGNED");

    // A second, independent work order: the preferred provider declines, and only an explicit
    // second `proposeAndCallArtisan` call escalates to backup — proving there is no automatic loop.
    const request2 = await createMaintenanceRequest(owner.id, organisation.id, { propertyId: property.id, title: "Second leak", description: "Bathroom pipe is leaking.", category: "plumbing" });
    await transitionMaintenanceRequest(owner.id, organisation.id, request2.id, { status: "TRIAGED" });
    const workOrder2 = await createWorkOrder(owner.id, organisation.id, request2.id, { title: "Fix second leak", currencyCode: "GHS" });
    const call2 = await proposeAndCallArtisan(owner.id, organisation.id, { workOrderId: workOrder2.id });
    expect(call2.toNumber).toBe("+233240000010");
    const declined = await recordArtisanCallResponse(owner.id, organisation.id, call2.id, { response: "UNAVAILABLE", note: "Fully booked today." });
    expect(declined.outcome).toBe("ARTISAN_DECLINED");

    const callsAfterDecline = await db.voiceCall.count({ where: { organisationId: organisation.id, dispatchAttemptId: { not: null } } });
    expect(callsAfterDecline).toBe(2); // no automatic third call was created

    const backupCall = await proposeAndCallArtisan(owner.id, organisation.id, { workOrderId: workOrder2.id });
    expect(backupCall.toNumber).toBe("+233240000011");
  });

  it("uses NesAfric marketplace fallback for artisan calls only when no internal provider exists and it is explicitly authorised", async () => {
    const owner = await registerUser({ displayName: "Voice Fallback Landlord", email: "voice-fallback-landlord@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Voice Fallback Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await scalePropertyOsOrg(organisation.id);
    await configureVoiceProvider(owner.id, organisation.id, { phoneNumber: "+233200000015", outboundEnabled: true, ...wideHours });
    const property = await createProperty(owner.id, organisation.id, { name: "Voice Fallback House", referenceNumber: "VFH-1", category: "Residential", countryCode: "GH", currencyCode: "GHS" });
    const electricalCategory = await db.serviceCategory.findUniqueOrThrow({ where: { key: "electrical" } });

    const outsideUser = await registerUser({ displayName: "Voice Marketplace Electrician", email: "voice-outside-electrician@example.com", password: "secure-password-123" });
    const outsideProvider = await createServiceProvider(outsideUser.id, { type: "INDIVIDUAL", displayName: "Voice Marketplace Electrician", contactEmail: "voice-outside-electrician@example.com", categoryIds: [electricalCategory.id] });
    await db.serviceProvider.update({ where: { id: outsideProvider.id }, data: { verificationStatus: "VERIFIED", acceptingWork: true, availabilityStatus: "AVAILABLE", contactPhone: "+233240000012" } });

    const request = await createMaintenanceRequest(owner.id, organisation.id, { propertyId: property.id, title: "Sparking outlet", description: "Outlet sparks intermittently.", category: "electrical" });
    await transitionMaintenanceRequest(owner.id, organisation.id, request.id, { status: "TRIAGED" });
    const workOrder = await createWorkOrder(owner.id, organisation.id, request.id, { title: "Inspect outlet", currencyCode: "GHS" });

    await expect(proposeAndCallArtisan(owner.id, organisation.id, { workOrderId: workOrder.id })).rejects.toMatchObject({ code: "NO_INTERNAL_PROVIDER_AVAILABLE" });
    const fallbackCall = await proposeAndCallArtisan(owner.id, organisation.id, { workOrderId: workOrder.id, allowMarketplaceFallback: true });
    expect(fallbackCall.toNumber).toBe("+233240000012");
  });

  it("places outbound prospect calls (viewing confirmation, follow-up) gated by consent/entitlement/policy, and transfers a marketplace call to a human", async () => {
    const owner = await registerUser({ displayName: "Voice Outbound Owner", email: "voice-outbound-owner@example.com", password: "secure-password-123" });
    const brokerage = await createMarketplaceProfessional(owner.id, { type: "BROKERAGE", displayName: "Outbound Brokerage", countryCode: "GH" });
    await changeMarketplacePlan(owner.id, brokerage.id, { planKey: "marketplace_brokerage" });
    await configureVoiceProvider(owner.id, brokerage.backingOrganisationId, { phoneNumber: "+233200000016", inboundEnabled: true, outboundEnabled: true, ...wideHours });
    const agent = await createMarketplaceAIEmployee(owner.id, brokerage.id, { name: "Yaw Sales Agent", role: "AI_SALES_AGENT", instructions: {}, escalationConfiguration: {} });
    void agent;

    const listing = await createNativeListing(owner.id, brokerage.id);
    await publishListing(owner.id, brokerage.backingOrganisationId, listing.id);
    const lead = await db.marketplaceLead.create({
      data: { organisationId: brokerage.backingOrganisationId, listingId: listing.id, name: "Callback Prospect", phone: "+233240000013", status: "NEW", history: { create: { toStatus: "NEW" } } },
    });

    const confirmationCall = await placeOutboundProspectCall(owner.id, brokerage.id, { marketplaceLeadId: lead.id, purpose: "VIEWING_CONFIRMATION" });
    expect(confirmationCall.direction).toBe("OUTBOUND");
    expect(confirmationCall.toNumber).toBe("+233240000013");

    const handoff = await requestVoiceHandoff(confirmationCall.id, { reason: "Prospect wants to negotiate price directly with a human agent.", urgency: "MEDIUM" });
    expect(handoff.id).toBeTruthy();
    const finalCall = await db.voiceCall.findUniqueOrThrow({ where: { id: confirmationCall.id } });
    expect(finalCall.outcome).toBe("HANDED_OFF_TO_HUMAN");
    expect(finalCall.handoffId).toBe(handoff.id);
  });

  it("places an approved outbound tenant call (lease expiry reminder) using a verified tenant record", async () => {
    const owner = await registerUser({ displayName: "Voice Tenant Outbound Landlord", email: "voice-tenant-outbound-landlord@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Voice Tenant Outbound Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await scalePropertyOsOrg(organisation.id);
    await configureVoiceProvider(owner.id, organisation.id, { phoneNumber: "+233200000017", outboundEnabled: true, ...wideHours });
    await createAIEmployee(owner.id, organisation.id, { name: "Ama Receptionist", role: "RECEPTIONIST", scope: "ORGANISATION", toolPermissions: [], instructions: {}, escalationConfiguration: {} });
    await createTenant(owner.id, organisation.id, { legalName: "Reminder Tenant", email: "voice-reminder-tenant@example.com", phone: "+233240000014" });
    const tenantOrg = await db.tenantOrganisation.findFirstOrThrow({ where: { organisationId: organisation.id, phone: "+233240000014" } });

    const call = await placeOutboundTenantCall(owner.id, organisation.id, { tenantOrganisationId: tenantOrg.id, purpose: "LEASE_EXPIRY_REMINDER" });
    expect(call.direction).toBe("OUTBOUND");
    expect(call.callerIdentityLevel).toBe("VERIFIED");
    expect(call.toNumber).toBe("+233240000014");
  });

  it("denies inbound voice handling when the receiving organisation lacks the voice entitlement, routing to human handoff instead", async () => {
    const owner = await registerUser({ displayName: "Growth Landlord", email: "voice-growth-landlord@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Growth Voice Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await db.organisationSubscription.update({ where: { organisationId: organisation.id }, data: { plan: { connect: { key: "growth" } } } });
    await configureVoiceProvider(owner.id, organisation.id, { phoneNumber: "+233200000018", inboundEnabled: true, ...wideHours });

    const { call, routing } = await startInboundCall({ toNumber: "+233200000018", fromNumber: "+233240000015" });
    expect(routing?.requiresHandoff).toBe(true);
    expect(call.outcome).toBe("HANDED_OFF_TO_HUMAN");
    expect(call.aiEmployeeId).toBeNull();
  });

  it("rejects an outbound artisan call when the maintenance voice-dispatch entitlement is not enabled on the plan, even though dispatch proposal itself is allowed", async () => {
    const owner = await registerUser({ displayName: "Growth Dispatch Landlord", email: "voice-growth-dispatch-landlord@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Growth Dispatch Voice Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await db.organisationSubscription.update({ where: { organisationId: organisation.id }, data: { plan: { connect: { key: "growth" } } } });
    const property = await createProperty(owner.id, organisation.id, { name: "Growth Dispatch House", referenceNumber: "GDH-1", category: "Residential", countryCode: "GH", currencyCode: "GHS" });
    const plumbingCategory = await db.serviceCategory.findUniqueOrThrow({ where: { key: "plumbing" } });
    const providerUser = await registerUser({ displayName: "Growth Plumber", email: "voice-growth-plumber@example.com", password: "secure-password-123" });
    const provider = await createServiceProvider(providerUser.id, { type: "INDIVIDUAL", displayName: "Growth Plumber", contactEmail: "voice-growth-plumber@example.com", categoryIds: [plumbingCategory.id] });
    await db.serviceProvider.update({ where: { id: provider.id }, data: { verificationStatus: "VERIFIED", acceptingWork: true, availabilityStatus: "AVAILABLE", contactPhone: "+233240000030" } });
    await addProviderToDirectory(owner.id, organisation.id, { providerId: provider.id });

    const request = await createMaintenanceRequest(owner.id, organisation.id, { propertyId: property.id, title: "Broken tap", description: "Tap will not shut off.", category: "plumbing" });
    await transitionMaintenanceRequest(owner.id, organisation.id, request.id, { status: "TRIAGED" });
    const workOrder = await createWorkOrder(owner.id, organisation.id, request.id, { title: "Fix tap", currencyCode: "GHS" });

    // Growth has `propertyos.maintenance.ai_dispatch` (proposal) but not
    // `propertyos.maintenance.voice_dispatch` (the call itself) — proposal succeeds, the call does not.
    const attempt = await proposeDispatch(owner.id, organisation.id, { workOrderId: workOrder.id });
    await expect(placeOutboundArtisanCall(owner.id, organisation.id, { dispatchAttemptId: attempt.id })).rejects.toMatchObject({ code: "ENTITLEMENT_FEATURE_DISABLED" });
  });

  it("keeps voice calls fully isolated across organisations, and enforces call idempotency on repeated inbound webhooks", async () => {
    const ownerA = await registerUser({ displayName: "Voice Iso Owner A", email: "voice-iso-owner-a@example.com", password: "secure-password-123" });
    const ownerB = await registerUser({ displayName: "Voice Iso Owner B", email: "voice-iso-owner-b@example.com", password: "secure-password-123" });
    const orgA = await createOrganisation(ownerA.id, { name: "Voice Iso Org A", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const orgB = await createOrganisation(ownerB.id, { name: "Voice Iso Org B", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await scalePropertyOsOrg(orgA.id);
    await scalePropertyOsOrg(orgB.id);
    await configureVoiceProvider(ownerA.id, orgA.id, { phoneNumber: "+233200000019", inboundEnabled: true, ...wideHours });
    await createAIEmployee(ownerA.id, orgA.id, { name: "Iso Receptionist", role: "RECEPTIONIST", scope: "ORGANISATION", toolPermissions: [], instructions: {}, escalationConfiguration: {} });

    const { call } = await startInboundCall({ toNumber: "+233200000019", fromNumber: "+233240000016", providerCallId: "idempotency-test-call-1" });
    const replay = await startInboundCall({ toNumber: "+233200000019", fromNumber: "+233240000016", providerCallId: "idempotency-test-call-1" });
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.call.id).toBe(call.id);
    expect(await db.voiceCall.count({ where: { organisationId: orgA.id } })).toBe(1);

    await expect(getVoiceCall(ownerB.id, orgB.id, call.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await listVoiceCalls(ownerB.id, orgB.id)).items).toEqual([]);
    await expect(getVoiceCall(ownerA.id, orgA.id, call.id)).resolves.toMatchObject({ id: call.id });
  });

  it("verifies webhook signatures, prevents replay, and applies a status transition exactly once", async () => {
    const owner = await registerUser({ displayName: "Voice Webhook Landlord", email: "voice-webhook-landlord@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Voice Webhook Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await scalePropertyOsOrg(organisation.id);
    await configureVoiceProvider(owner.id, organisation.id, { phoneNumber: "+233200000020", inboundEnabled: true, ...wideHours });
    await createAIEmployee(owner.id, organisation.id, { name: "Webhook Receptionist", role: "RECEPTIONIST", scope: "ORGANISATION", toolPermissions: [], instructions: {}, escalationConfiguration: {} });
    const { call } = await startInboundCall({ toNumber: "+233200000020", fromNumber: "+233240000017", providerCallId: "webhook-test-call-1" });

    const body = JSON.stringify({ externalEventId: "evt-1", type: "call.ringing", providerCallId: "webhook-test-call-1" });
    await expect(ingestProviderWebhook("MOCK", body, { "x-voice-signature": "wrong-signature" })).rejects.toMatchObject({ code: "VOICE_WEBHOOK_SIGNATURE_INVALID" });

    const signature = signMockVoiceWebhook(body);
    const first = await ingestProviderWebhook("MOCK", body, { "x-voice-signature": signature });
    expect(first.replay).toBe(false);
    expect((await db.voiceCall.findUniqueOrThrow({ where: { id: call.id } })).status).toBe("RINGING");

    const replay = await ingestProviderWebhook("MOCK", body, { "x-voice-signature": signature });
    expect(replay.replay).toBe(true);
    expect(await db.voiceCallEvent.count({ where: { callId: call.id } })).toBe(1);
  });

  it("enforces the outbound calling frequency limit and do-not-call contact preference, and records a real provider outage", async () => {
    const owner = await registerUser({ displayName: "Voice Policy Owner", email: "voice-policy-owner@example.com", password: "secure-password-123" });
    const brokerage = await createMarketplaceProfessional(owner.id, { type: "BROKERAGE", displayName: "Policy Brokerage", countryCode: "GH" });
    await changeMarketplacePlan(owner.id, brokerage.id, { planKey: "marketplace_brokerage" });
    await configureVoiceProvider(owner.id, brokerage.backingOrganisationId, { phoneNumber: "+233200000021", outboundEnabled: true, maxOutboundCallsPerDay: 1, ...wideHours });
    const listing = await createNativeListing(owner.id, brokerage.id);
    await publishListing(owner.id, brokerage.backingOrganisationId, listing.id);

    const leadA = await db.marketplaceLead.create({ data: { organisationId: brokerage.backingOrganisationId, listingId: listing.id, name: "Lead A", phone: "+233240000020", status: "NEW", history: { create: { toStatus: "NEW" } } } });
    const leadB = await db.marketplaceLead.create({ data: { organisationId: brokerage.backingOrganisationId, listingId: listing.id, name: "Lead B", phone: "+233240000021", status: "NEW", history: { create: { toStatus: "NEW" } } } });
    const leadOptedOut = await db.marketplaceLead.create({ data: { organisationId: brokerage.backingOrganisationId, listingId: listing.id, name: "Opted Out Lead", phone: "+233240000022", status: "NEW", history: { create: { toStatus: "NEW" } } } });
    const leadOutage = await db.marketplaceLead.create({ data: { organisationId: brokerage.backingOrganisationId, listingId: listing.id, name: "Outage Lead", phone: "+0000000001", status: "NEW", history: { create: { toStatus: "NEW" } } } });

    await placeOutboundProspectCall(owner.id, brokerage.id, { marketplaceLeadId: leadA.id, purpose: "FOLLOW_UP" });
    await expect(placeOutboundProspectCall(owner.id, brokerage.id, { marketplaceLeadId: leadB.id, purpose: "FOLLOW_UP" })).rejects.toMatchObject({ code: "VOICE_OUTBOUND_FREQUENCY_LIMIT" });

    await setVoiceContactPreference(owner.id, brokerage.backingOrganisationId, { phoneNumber: "+233240000022", doNotCall: true, reason: "Requested no further contact." });
    await configureVoiceProvider(owner.id, brokerage.backingOrganisationId, { maxOutboundCallsPerDay: 10 });
    await expect(placeOutboundProspectCall(owner.id, brokerage.id, { marketplaceLeadId: leadOptedOut.id, purpose: "FOLLOW_UP" })).rejects.toMatchObject({ code: "VOICE_CONTACT_OPTED_OUT" });

    const outageCall = await placeOutboundProspectCall(owner.id, brokerage.id, { marketplaceLeadId: leadOutage.id, purpose: "FOLLOW_UP" });
    expect(outageCall.status).toBe("FAILED");
    expect(outageCall.failureReason).toContain("Simulated provider outage");
  });

  it("computes real voice analytics from recorded calls — never fabricated", async () => {
    const owner = await registerUser({ displayName: "Voice Analytics Owner", email: "voice-analytics-owner@example.com", password: "secure-password-123" });
    const brokerage = await createMarketplaceProfessional(owner.id, { type: "BROKERAGE", displayName: "Analytics Brokerage", countryCode: "GH" });
    await changeMarketplacePlan(owner.id, brokerage.id, { planKey: "marketplace_brokerage" });
    await configureVoiceProvider(owner.id, brokerage.backingOrganisationId, { phoneNumber: "+233200000022", inboundEnabled: true, outboundEnabled: true, ...wideHours });
    await createMarketplaceAIEmployee(owner.id, brokerage.id, { name: "Analytics Receptionist", role: "AI_SALES_RECEPTIONIST", instructions: {}, escalationConfiguration: {} });
    const listing = await createNativeListing(owner.id, brokerage.id);
    await publishListing(owner.id, brokerage.backingOrganisationId, listing.id);

    const { call: inboundCall } = await startInboundCall({ toNumber: "+233200000022", fromNumber: "+233240000023" });
    await captureVoiceLead(inboundCall.id, { listingId: listing.id, name: "Analytics Prospect", phone: "+233240000023" });

    const lead = await db.marketplaceLead.create({ data: { organisationId: brokerage.backingOrganisationId, listingId: listing.id, name: "Analytics Follow-up", phone: "+233240000024", status: "NEW", history: { create: { toStatus: "NEW" } } } });
    await placeOutboundProspectCall(owner.id, brokerage.id, { marketplaceLeadId: lead.id, purpose: "FOLLOW_UP" });

    const analytics = await getVoiceAnalytics(owner.id, brokerage.backingOrganisationId);
    expect(analytics.inboundCalls).toBe(1);
    expect(analytics.outboundCalls).toBe(1);
    expect(analytics.enquiriesConvertedToLeads).toBe(1);
  });
});
