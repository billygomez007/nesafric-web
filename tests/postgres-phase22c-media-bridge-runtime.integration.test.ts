import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/platform/database/client";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { createProperty } from "@/modules/assets/service";
import { createMarketplaceNativeListing, updateListingVerification, transitionListing } from "@/modules/listings/service";
import { createMaintenanceRequest, createWorkOrder, transitionMaintenanceRequest } from "@/modules/maintenance/service";
import { createServiceProvider, addProviderToDirectory } from "@/modules/providers/service";
import { createMarketplaceProfessional, changeMarketplacePlan } from "@/modules/marketplace-professionals/service";
import { createMarketplaceAIEmployee } from "@/modules/marketplace-ai/service";
import { createAIEmployee } from "@/modules/ai-employees/service";
import { updateAutonomyConfiguration, upsertAutonomyPolicy } from "@/modules/ai-autonomy/service";
import { createTenant } from "@/modules/tenants/service";
import { createDevelopment, createDevelopmentUnit } from "@/modules/developments/service";
import { setVoicePersonaConfig } from "@/modules/voice/persona";
import {
  issueMediaStreamToken,
  authenticateMediaStream,
  submitMediaStreamFrame,
  closeMediaStream,
  sweepOrphanedMediaStreams,
  getMediaStreamByCall,
} from "@/modules/voice/media-bridge";
import {
  configureVoiceProvider,
  startInboundCall,
  proposeAndCallArtisan,
  recordArtisanCallResponse,
  autoEscalateArtisanDispatch,
  transferCallToHuman,
  beginRealtimeSession,
  checkCallSilence,
  routeVoiceTranscript,
  getCallRealtimeSession,
  getVoiceHealthStatus,
  getVoiceOperationalSnapshot,
  placeOutboundProspectCall,
  placeOutboundTenantCall,
} from "@/modules/voice/service";
import { getEntitlementSnapshot } from "@/modules/entitlements/service";
import { createEntitlementOverride } from "@/modules/platform-admin/service";

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

describe("PostgreSQL Phase 22C live media bridge + voice runtime enforcement", () => {
  beforeEach(cleanDatabase);
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("issues, authenticates, and rejects media-stream tokens correctly: valid connect, invalid token, cross-org isolation, and duplicate-stream prevention", async () => {
    const ownerA = await registerUser({ displayName: "Bridge Owner A", email: "bridge-owner-a@example.com", password: "secure-password-123" });
    const ownerB = await registerUser({ displayName: "Bridge Owner B", email: "bridge-owner-b@example.com", password: "secure-password-123" });
    const orgA = await createOrganisation(ownerA.id, { name: "Bridge Org A", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const orgB = await createOrganisation(ownerB.id, { name: "Bridge Org B", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await scalePropertyOsOrg(orgA.id);
    await scalePropertyOsOrg(orgB.id);
    await configureVoiceProvider(ownerA.id, orgA.id, { phoneNumber: "+233210000001", inboundEnabled: true, ...wideHours });
    await createAIEmployee(ownerA.id, orgA.id, { name: "Bridge Receptionist A", role: "RECEPTIONIST", scope: "ORGANISATION", toolPermissions: [], instructions: {}, escalationConfiguration: {} });
    const { call } = await startInboundCall({ toNumber: "+233210000001", fromNumber: "+233240110001" });
    // Inbound routing already auto-attaches a media stream the moment an AI employee answers —
    // close it first so this test can exercise manual issuance/authentication explicitly.
    const autoAttached = await getMediaStreamByCall(call.id);
    if (autoAttached) await closeMediaStream(autoAttached.streamToken, "test_setup");

    // Invalid token rejection.
    await expect(authenticateMediaStream("garbage-token-that-does-not-exist")).rejects.toMatchObject({ code: "VOICE_MEDIA_STREAM_UNAUTHORIZED" });

    // Valid connect: resolves org/call strictly from the token, never from client input.
    const issued = await issueMediaStreamToken(call.id);
    const authenticated = await authenticateMediaStream(issued.streamToken);
    expect(authenticated).toMatchObject({ callId: call.id, organisationId: orgA.id });

    // The token is single-use to connect: authenticating again with the same (now CONNECTED) token fails.
    await expect(authenticateMediaStream(issued.streamToken)).rejects.toMatchObject({ code: "VOICE_MEDIA_STREAM_UNAUTHORIZED" });

    // Duplicate-active-stream prevention: a second token for the same call cannot be issued while one is still active.
    await expect(issueMediaStreamToken(call.id)).rejects.toMatchObject({ code: "VOICE_MEDIA_STREAM_ALREADY_ACTIVE" });

    // Cross-organisation isolation is structural: org B has no way to even name org A's call, and
    // org B's own call/token pair only ever resolves to org B.
    await configureVoiceProvider(ownerB.id, orgB.id, { phoneNumber: "+233210000002", inboundEnabled: true, ...wideHours });
    await createAIEmployee(ownerB.id, orgB.id, { name: "Bridge Receptionist B", role: "RECEPTIONIST", scope: "ORGANISATION", toolPermissions: [], instructions: {}, escalationConfiguration: {} });
    const { call: callB } = await startInboundCall({ toNumber: "+233210000002", fromNumber: "+233240110002" });
    const issuedB = await getMediaStreamByCall(callB.id);
    if (!issuedB) throw new Error("expected an auto-attached media stream for callB");
    const authenticatedB = await authenticateMediaStream(issuedB.streamToken);
    expect(authenticatedB.organisationId).toBe(orgB.id);
    expect(authenticatedB.organisationId).not.toBe(orgA.id);

    await closeMediaStream(issued.streamToken, "test_cleanup");
    // Once closed, a fresh token CAN be issued for the same call (not a permanent lock).
    const reissued = await issueMediaStreamToken(call.id);
    expect(reissued.id).not.toBe(issued.id);
  });

  it("drives caller audio through the media bridge end-to-end: incremental STT, final transcript, TTS audio response, and barge-in — a real live listing enquiry", async () => {
    const owner = await registerUser({ displayName: "Bridge Flow Owner", email: "bridge-flow-owner@example.com", password: "secure-password-123" });
    const brokerage = await createMarketplaceProfessional(owner.id, { type: "BROKERAGE", displayName: "Bridge Flow Brokerage", countryCode: "GH" });
    await changeMarketplacePlan(owner.id, brokerage.id, { planKey: "marketplace_brokerage" });
    await configureVoiceProvider(owner.id, brokerage.backingOrganisationId, { phoneNumber: "+233210000003", inboundEnabled: true, ...wideHours });
    await createMarketplaceAIEmployee(owner.id, brokerage.id, { name: "Bridge Ama", role: "AI_SALES_RECEPTIONIST", instructions: {}, escalationConfiguration: {} });
    const listing = await createNativeListing(owner.id, brokerage.id);
    await publishListing(owner.id, brokerage.backingOrganisationId, listing.id);

    const { call } = await startInboundCall({ toNumber: "+233210000003", fromNumber: "+233240110003" });
    await beginRealtimeSession(call.id);
    const issued = await getMediaStreamByCall(call.id);
    if (!issued) throw new Error("expected an auto-attached media stream");
    await authenticateMediaStream(issued.streamToken);

    // Incremental STT: a partial chunk never triggers routing.
    const partial = await submitMediaStreamFrame(issued.streamToken, { simulatedText: "Is the two-bedroom", isFinalChunk: false });
    expect(partial.status).toBe("LISTENING");

    // Final transcript: the exact spoken scenario from the spec.
    const final = await submitMediaStreamFrame(issued.streamToken, { simulatedText: " apartment in East Legon still available?", isFinalChunk: true });
    expect(final.status).toBe("AI_SPEAKING");
    expect(final.kind).toBe("AVAILABILITY");
    expect("audioRef" in final ? final.audioRef : undefined).toContain("mock-audio://");
    const stream = await db.mediaStreamSession.findUnique({ where: { id: issued.id } });
    expect(stream?.frameCount).toBe(2);
    expect((await getCallRealtimeSession(call.id))?.state).toBe("AI_SPEAKING");

    // Barge-in: caller audio arriving mid-AI-speech interrupts it, delivered through the bridge too.
    const interrupted = await submitMediaStreamFrame(issued.streamToken, { simulatedText: "actually", isFinalChunk: false });
    expect(interrupted.bargeIn).toBe(true);
  });

  it("silence-times-out and cleanly disconnects a call, closing its active media stream", async () => {
    const owner = await registerUser({ displayName: "Bridge Silence Owner", email: "bridge-silence-owner@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Bridge Silence Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await scalePropertyOsOrg(organisation.id);
    await configureVoiceProvider(owner.id, organisation.id, { phoneNumber: "+233210000004", inboundEnabled: true, ...wideHours });
    await createAIEmployee(owner.id, organisation.id, { name: "Bridge Silence Receptionist", role: "RECEPTIONIST", scope: "ORGANISATION", toolPermissions: [], instructions: {}, escalationConfiguration: {} });
    const { call } = await startInboundCall({ toNumber: "+233210000004", fromNumber: "+233240110004" });
    await beginRealtimeSession(call.id);
    await db.voiceStreamingSession.update({ where: { callId: call.id }, data: { silenceTimeoutSeconds: 5 } });
    const issued = await getMediaStreamByCall(call.id);
    if (!issued) throw new Error("expected an auto-attached media stream");
    await authenticateMediaStream(issued.streamToken);

    await checkCallSilence(call.id, new Date(Date.now() + 6_000));
    await checkCallSilence(call.id, new Date(Date.now() + 12_000));

    const finalCall = await db.voiceCall.findUniqueOrThrow({ where: { id: call.id } });
    expect(finalCall.status).toBe("COMPLETED");
    const finalStream = await getMediaStreamByCall(call.id);
    expect(finalStream?.status).toBe("CLOSED");
  });

  it("terminates a call outright once it exceeds the configured maximum call duration (cost protection)", async () => {
    const owner = await registerUser({ displayName: "Duration Owner", email: "duration-owner@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Duration Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await scalePropertyOsOrg(organisation.id);
    await configureVoiceProvider(owner.id, organisation.id, { phoneNumber: "+233210000005", inboundEnabled: true, maxCallDurationSeconds: 60, ...wideHours });
    await createAIEmployee(owner.id, organisation.id, { name: "Duration Receptionist", role: "RECEPTIONIST", scope: "ORGANISATION", toolPermissions: [], instructions: {}, escalationConfiguration: {} });
    const { call } = await startInboundCall({ toNumber: "+233210000005", fromNumber: "+233240110005" });
    await beginRealtimeSession(call.id);

    const result = await checkCallSilence(call.id, new Date(Date.now() + 120_000));
    expect(result).toMatchObject({ timedOut: true, action: "MAX_DURATION_EXCEEDED" });
    const finalCall = await db.voiceCall.findUniqueOrThrow({ where: { id: call.id } });
    expect(finalCall.status).toBe("COMPLETED");
  });

  it("sweeps orphaned media streams: an expired connect window and a connection gone quiet are both closed, an active one is left alone", async () => {
    const owner = await registerUser({ displayName: "Orphan Owner", email: "orphan-owner@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Orphan Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await scalePropertyOsOrg(organisation.id);
    await configureVoiceProvider(owner.id, organisation.id, { phoneNumber: "+233210000006", inboundEnabled: true, ...wideHours });
    await createAIEmployee(owner.id, organisation.id, { name: "Orphan Receptionist", role: "RECEPTIONIST", scope: "ORGANISATION", toolPermissions: [], instructions: {}, escalationConfiguration: {} });

    // Inbound routing already auto-attaches a media stream (PENDING) the moment an AI employee
    // answers — this test uses those auto-attached streams directly rather than issuing new ones.
    const { call: call1 } = await startInboundCall({ toNumber: "+233210000006", fromNumber: "+233240110006" });
    const neverConnected = await getMediaStreamByCall(call1.id);
    if (!neverConnected) throw new Error("expected an auto-attached media stream");

    const { call: call2 } = await startInboundCall({ toNumber: "+233210000006", fromNumber: "+233240110007" });
    const goneQuiet = await getMediaStreamByCall(call2.id);
    if (!goneQuiet) throw new Error("expected an auto-attached media stream");
    await authenticateMediaStream(goneQuiet.streamToken);
    await db.mediaStreamSession.update({ where: { id: goneQuiet.id }, data: { lastFrameAt: new Date(Date.now() - 10 * 60 * 1000) } });

    const { call: call3 } = await startInboundCall({ toNumber: "+233210000006", fromNumber: "+233240110008" });
    const stillActive = await getMediaStreamByCall(call3.id);
    if (!stillActive) throw new Error("expected an auto-attached media stream");
    await authenticateMediaStream(stillActive.streamToken);
    const sweepTime = new Date(Date.now() + 3 * 60 * 1000);
    // Simulates frames still arriving right up to the moment the sweep runs — zero seconds idle.
    await db.mediaStreamSession.update({ where: { id: stillActive.id }, data: { lastFrameAt: sweepTime } });

    const swept = await sweepOrphanedMediaStreams(sweepTime);
    expect(swept.expiredPending).toBeGreaterThanOrEqual(1);
    expect(swept.orphanedClosed).toBeGreaterThanOrEqual(1);

    expect((await db.mediaStreamSession.findUniqueOrThrow({ where: { id: neverConnected.id } })).status).toBe("EXPIRED");
    expect((await db.mediaStreamSession.findUniqueOrThrow({ where: { id: goneQuiet.id } })).status).toBe("CLOSED");
    expect((await db.mediaStreamSession.findUniqueOrThrow({ where: { id: stillActive.id } })).status).toBe("CONNECTED");
  });

  it("searches developer inventory from a natural spoken price/bedroom/purpose description ('I need a three-bedroom unit under GHS 2 million')", async () => {
    const owner = await registerUser({ displayName: "Dev Search Owner", email: "dev-search-owner@example.com", password: "secure-password-123" });
    const developer = await createMarketplaceProfessional(owner.id, { type: "DEVELOPER", displayName: "Dev Search Developer", countryCode: "GH" });
    await changeMarketplacePlan(owner.id, developer.id, { planKey: "marketplace_pro" });
    await configureVoiceProvider(owner.id, developer.backingOrganisationId, { phoneNumber: "+233210000007", inboundEnabled: true, ...wideHours });
    await createMarketplaceAIEmployee(owner.id, developer.id, { name: "Dev Search Receptionist", role: "AI_SALES_RECEPTIONIST", instructions: {}, escalationConfiguration: {} });

    const development = await createDevelopment(owner.id, developer.id, { name: "Search Gardens", countryCode: "GH" });
    const matchingUnit = await createDevelopmentUnit(owner.id, developer.id, development.id, { name: "Block C - Unit 1", unitType: "3-bedroom", bedrooms: 3, priceMinor: "150000000", currencyCode: "GHS" });
    const tooExpensiveUnit = await createDevelopmentUnit(owner.id, developer.id, development.id, { name: "Block C - Unit 2 (Penthouse)", unitType: "3-bedroom", bedrooms: 3, priceMinor: "500000000", currencyCode: "GHS" });
    const matchingListing = await createNativeListing(owner.id, developer.id, {
      listing: { listingType: "SALE", category: "apartment", title: "Search Gardens 3-bed", publicDescription: "A three-bedroom unit with flexible viewing availability.", currencyCode: "GHS", askingAmountMinor: "150000000", availableFrom: "2026-09-01", countryCode: "GH", bedrooms: 3, media: [{ type: "PHOTO", publicUrl: "https://cdn.example.com/listing/photo.jpg" }] },
      asset: { developmentUnitId: matchingUnit.id, name: "Search Gardens 3-bed", category: "apartment", purpose: "SALE", bedrooms: 3, currencyCode: "GHS", priceMinor: "150000000", countryCode: "GH", availableFrom: "2026-09-01" },
    });
    await publishListing(owner.id, developer.backingOrganisationId, matchingListing.id);
    const expensiveListing = await createNativeListing(owner.id, developer.id, {
      listing: { listingType: "SALE", category: "apartment", title: "Search Gardens Penthouse", publicDescription: "A three-bedroom penthouse with flexible viewing availability.", currencyCode: "GHS", askingAmountMinor: "500000000", availableFrom: "2026-09-01", countryCode: "GH", bedrooms: 3, media: [{ type: "PHOTO", publicUrl: "https://cdn.example.com/listing/photo.jpg" }] },
      asset: { developmentUnitId: tooExpensiveUnit.id, name: "Search Gardens Penthouse", category: "apartment", purpose: "SALE", bedrooms: 3, currencyCode: "GHS", priceMinor: "500000000", countryCode: "GH", availableFrom: "2026-09-01" },
    });
    await publishListing(owner.id, developer.backingOrganisationId, expensiveListing.id);

    const { call } = await startInboundCall({ toNumber: "+233210000007", fromNumber: "+233240110009" });
    const routed = await routeVoiceTranscript(call.id, "I need a three-bedroom unit for sale under GHS 2 million.");
    expect(routed.kind).toBe("INVENTORY");
    const results = routed.data as Array<{ id: string }>;
    expect(results.map((r) => r.id)).toContain(matchingListing.id);
    expect(results.map((r) => r.id)).not.toContain(expensiveListing.id);
  });

  it("protects tenant private data until identity is verified, then reports a maintenance issue by category and creates the AI-gated request", async () => {
    const owner = await registerUser({ displayName: "Bridge Tenant Landlord", email: "bridge-tenant-landlord@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Bridge Tenant Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await scalePropertyOsOrg(organisation.id);
    await configureVoiceProvider(owner.id, organisation.id, { phoneNumber: "+233210000008", inboundEnabled: true, ...wideHours });
    await updateAutonomyConfiguration(owner.id, organisation.id, { enabled: true, defaultLevel: "RECOMMEND_ONLY", communicationAllowed: true });
    const property = await createProperty(owner.id, organisation.id, { name: "Bridge Tenant House", referenceNumber: "BTH-1", category: "Residential", countryCode: "GH", currencyCode: "GHS" });
    const policy = await upsertAutonomyPolicy(owner.id, organisation.id, { actionKey: "maintenance.create", enabled: true, level: "APPROVAL_REQUIRED", propertyId: property.id, timezone: "UTC" });
    await createAIEmployee(owner.id, organisation.id, { name: "Bridge Tenant Receptionist", role: "RECEPTIONIST", scope: "ORGANISATION", toolPermissions: ["tenants.history", "maintenance.create"], autonomyPolicyIds: [policy.id], instructions: {}, escalationConfiguration: {} });
    await createTenant(owner.id, organisation.id, { legalName: "Bridge Tenant", email: "bridge-tenant@example.com", phone: "+233240110010" });

    const { call } = await startInboundCall({ toNumber: "+233210000008", fromNumber: "+233240110010" });
    const denied = await routeVoiceTranscript(call.id, "What is my rent balance?");
    expect(denied.kind).toBe("IDENTITY_REQUIRED");

    await db.voiceCall.update({ where: { id: call.id }, data: { callerIdentityLevel: "VERIFIED" } });
    await db.conversation.update({ where: { id: call.conversationId }, data: { identityLevel: "VERIFIED", tenantOrganisationId: (await db.tenantOrganisation.findFirstOrThrow({ where: { organisationId: organisation.id } })).id, propertyId: property.id } });

    const maintenance = await routeVoiceTranscript(call.id, "My air conditioner stopped working completely.");
    expect(maintenance.kind).toBe("MAINTENANCE");
  });

  it("completes the live artisan-call conversation loop: dispatch, real outbound call, interpreting 'available later today', and human transfer closing the active media stream", async () => {
    const owner = await registerUser({ displayName: "Bridge Artisan Landlord", email: "bridge-artisan-landlord@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Bridge Artisan Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await scalePropertyOsOrg(organisation.id);
    await configureVoiceProvider(owner.id, organisation.id, { phoneNumber: "+233210000009", outboundEnabled: true, inboundEnabled: true, ...wideHours });
    await updateAutonomyConfiguration(owner.id, organisation.id, { enabled: true, defaultLevel: "RECOMMEND_ONLY", communicationAllowed: true });
    const property = await createProperty(owner.id, organisation.id, { name: "Bridge Artisan House", referenceNumber: "BAH-1", category: "Residential", countryCode: "GH", currencyCode: "GHS" });
    // Note: `MaintenanceRequest.category` ("air conditioning") and `ServiceCategory.key` ("hvac")
    // are separate, pre-existing (Phase 21) vocabularies that only happen to align exactly for
    // plumbing/electrical in the seed data — using "plumbing" here keeps this test focused on the
    // live voice/dispatch-call mechanics rather than that unrelated taxonomy mismatch.
    const plumbingCategory = await db.serviceCategory.findUniqueOrThrow({ where: { key: "plumbing" } });
    const providerUser = await registerUser({ displayName: "Bridge Plumber", email: "bridge-plumber-tech@example.com", password: "secure-password-123" });
    const provider = await createServiceProvider(providerUser.id, { type: "INDIVIDUAL", displayName: "Bridge Plumber", contactEmail: "bridge-plumber-tech@example.com", categoryIds: [plumbingCategory.id] });
    await db.serviceProvider.update({ where: { id: provider.id }, data: { verificationStatus: "VERIFIED", acceptingWork: true, availabilityStatus: "AVAILABLE", contactPhone: "+233240110011" } });
    await addProviderToDirectory(owner.id, organisation.id, { providerId: provider.id });

    const request = await createMaintenanceRequest(owner.id, organisation.id, { propertyId: property.id, title: "Leaking pipe", description: "Kitchen pipe is leaking.", category: "plumbing" });
    await transitionMaintenanceRequest(owner.id, organisation.id, request.id, { status: "TRIAGED" });
    const workOrder = await createWorkOrder(owner.id, organisation.id, request.id, { title: "Inspect AC", currencyCode: "GHS" });

    const call = await proposeAndCallArtisan(owner.id, organisation.id, { workOrderId: workOrder.id });
    expect(call.status).toBe("IN_PROGRESS");
    expect(call.toNumber).toBe("+233240110011");
    // The returned object is a snapshot from before the transcript line is appended (the same
    // established convention the Phase 22 tests already re-fetch around) — read it fresh.
    expect((await db.voiceCall.findUniqueOrThrow({ where: { id: call.id } })).transcriptText).toBeTruthy();

    // "Available later today" -> AVAILABLE_AT_TIME with a scheduled time, not a flat accept/decline.
    const scheduledAt = new Date(Date.now() + 4 * 60 * 60 * 1000);
    const responded = await recordArtisanCallResponse(owner.id, organisation.id, call.id, { response: "AVAILABLE_AT_TIME", scheduledAt, note: "Can come after 2pm." });
    expect(responded.outcome).toBe("ARTISAN_ACCEPTED");
    expect((await db.workOrder.findUniqueOrThrow({ where: { id: workOrder.id } })).status).toBe("ASSIGNED");

    // Separately: a human transfer on an unrelated inbound call closes its own active media stream.
    await createAIEmployee(owner.id, organisation.id, { name: "Bridge Transfer Receptionist", role: "RECEPTIONIST", scope: "ORGANISATION", toolPermissions: [], instructions: {}, escalationConfiguration: {} });
    const { call: inboundCall } = await startInboundCall({ toNumber: "+233210000009", fromNumber: "+233240110012" });
    await beginRealtimeSession(inboundCall.id);
    const issued = await getMediaStreamByCall(inboundCall.id);
    if (!issued) throw new Error("expected an auto-attached media stream");
    await authenticateMediaStream(issued.streamToken);
    await transferCallToHuman(inboundCall.id, { toNumber: "+233240110099" });
    expect((await db.mediaStreamSession.findUniqueOrThrow({ where: { id: issued.id } })).status).toBe("CLOSED");
  });

  it("escalates a declined artisan dispatch to backup deterministically and idempotently (no call loop), using the reserve-then-fulfil concurrency-safe call creation path", async () => {
    const owner = await registerUser({ displayName: "Bridge Escalation Landlord", email: "bridge-escalation-landlord@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Bridge Escalation Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await scalePropertyOsOrg(organisation.id);
    await configureVoiceProvider(owner.id, organisation.id, { phoneNumber: "+233210000010", outboundEnabled: true, retryDelaySeconds: 30, ...wideHours });
    const property = await createProperty(owner.id, organisation.id, { name: "Bridge Escalation House", referenceNumber: "BEH-1", category: "Residential", countryCode: "GH", currencyCode: "GHS" });
    const plumbingCategory = await db.serviceCategory.findUniqueOrThrow({ where: { key: "plumbing" } });
    async function verifiedProvider(email: string, displayName: string, phone: string) {
      const user = await registerUser({ displayName, email, password: "secure-password-123" });
      const provider = await createServiceProvider(user.id, { type: "INDIVIDUAL", displayName, contactEmail: email, categoryIds: [plumbingCategory.id] });
      await db.serviceProvider.update({ where: { id: provider.id }, data: { verificationStatus: "VERIFIED", acceptingWork: true, availabilityStatus: "AVAILABLE", contactPhone: phone } });
      return provider;
    }
    const preferred = await verifiedProvider("bridge-escalation-preferred@example.com", "Bridge Escalation Preferred", "+233240110013");
    const backup = await verifiedProvider("bridge-escalation-backup@example.com", "Bridge Escalation Backup", "+233240110014");
    await addProviderToDirectory(owner.id, organisation.id, { providerId: preferred.id });
    await db.providerOrganisation.updateMany({ where: { providerId: preferred.id }, data: { priority: 10 } });
    await addProviderToDirectory(owner.id, organisation.id, { providerId: backup.id });
    await db.providerOrganisation.updateMany({ where: { providerId: backup.id }, data: { isBackup: true } });

    const request = await createMaintenanceRequest(owner.id, organisation.id, { propertyId: property.id, title: "Bridge leak", description: "Leak.", category: "plumbing" });
    await transitionMaintenanceRequest(owner.id, organisation.id, request.id, { status: "TRIAGED" });
    const workOrder = await createWorkOrder(owner.id, organisation.id, request.id, { title: "Fix bridge leak", currencyCode: "GHS" });

    const call = await proposeAndCallArtisan(owner.id, organisation.id, { workOrderId: workOrder.id });
    await recordArtisanCallResponse(owner.id, organisation.id, call.id, { response: "UNAVAILABLE" });
    const attempt = await db.maintenanceDispatchAttempt.findFirstOrThrow({ where: { workOrderId: workOrder.id } });
    await db.maintenanceDispatchAttempt.update({ where: { id: attempt.id }, data: { respondedAt: new Date(Date.now() - 3_600_000) } });

    const escalated = await autoEscalateArtisanDispatch(owner.id, organisation.id, workOrder.id);
    expect(escalated.escalated).toBe(true);
    if (escalated.escalated) {
      expect(escalated.call.toNumber).toBe("+233240110014");
      expect(escalated.call.status).toBe("IN_PROGRESS"); // the real dial actually succeeded, not just reserved
    }
    const again = await autoEscalateArtisanDispatch(owner.id, organisation.id, workOrder.id);
    expect(again).toMatchObject({ escalated: false, reason: "not_pending_escalation" });
  });

  it("hard-blocks a new outbound call once the organisation's monthly outbound voice-minute entitlement is already exhausted", async () => {
    const owner = await registerUser({ displayName: "Minutes Owner", email: "minutes-owner@example.com", password: "secure-password-123" });
    const brokerage = await createMarketplaceProfessional(owner.id, { type: "BROKERAGE", displayName: "Minutes Brokerage", countryCode: "GH" });
    await changeMarketplacePlan(owner.id, brokerage.id, { planKey: "marketplace_brokerage" }); // outbound calls enabled, 500 outbound minutes/month
    await configureVoiceProvider(owner.id, brokerage.backingOrganisationId, { phoneNumber: "+233210000011", outboundEnabled: true, ...wideHours });
    const listing = await createNativeListing(owner.id, brokerage.id);
    await publishListing(owner.id, brokerage.backingOrganisationId, listing.id);
    const lead = await db.marketplaceLead.create({ data: { organisationId: brokerage.backingOrganisationId, listingId: listing.id, name: "Minutes Lead", phone: "+233240110015", status: "NEW", history: { create: { toStatus: "NEW" } } } });

    // Pre-existing usage already past the plan's 500-minute monthly ceiling for this period.
    const conversation = await db.conversation.create({ data: { organisationId: brokerage.backingOrganisationId, channel: "VOICE", status: "RESOLVED" } });
    await db.voiceCall.create({
      data: { organisationId: brokerage.backingOrganisationId, conversationId: conversation.id, direction: "OUTBOUND", status: "COMPLETED", fromNumber: "+233210000011", toNumber: "+233240110099", providerKey: "MOCK", providerCallId: `seed_${crypto.randomUUID()}`, durationSeconds: 501 * 60, endedAt: new Date() },
    });

    await expect(placeOutboundProspectCall(owner.id, brokerage.id, { marketplaceLeadId: lead.id, purpose: "FOLLOW_UP" })).rejects.toMatchObject({ code: "MARKETPLACE_ENTITLEMENT_LIMIT_REACHED" });
  });

  it("never disconnects an inbound caller when voice minutes are exhausted — routes to human handoff by default, and allows an explicit grace opt-in", async () => {
    const owner = await registerUser({ displayName: "Inbound Minutes Landlord", email: "inbound-minutes-landlord@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Inbound Minutes Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await scalePropertyOsOrg(organisation.id); // 2000 inbound minutes/month
    await configureVoiceProvider(owner.id, organisation.id, { phoneNumber: "+233210000012", inboundEnabled: true, ...wideHours });
    await createAIEmployee(owner.id, organisation.id, { name: "Inbound Minutes Receptionist", role: "RECEPTIONIST", scope: "ORGANISATION", toolPermissions: [], instructions: {}, escalationConfiguration: {} });

    // Push usage far past the plan's inbound-minutes ceiling.
    const conversation = await db.conversation.create({ data: { organisationId: organisation.id, channel: "VOICE", status: "RESOLVED" } });
    await db.voiceCall.create({
      data: { organisationId: organisation.id, conversationId: conversation.id, direction: "INBOUND", status: "COMPLETED", fromNumber: "+233240000000", toNumber: "+233210000012", providerKey: "MOCK", providerCallId: `seed_${crypto.randomUUID()}`, durationSeconds: 2001 * 60, endedAt: new Date() },
    });

    const { call: handoffCall, routing } = await startInboundCall({ toNumber: "+233210000012", fromNumber: "+233240110016" });
    expect(routing?.requiresHandoff).toBe(true);
    expect(handoffCall.aiEmployeeId).toBeNull();
    expect(handoffCall.outcome).toBe("HANDED_OFF_TO_HUMAN");

    // Explicit grace opt-in: the same exhausted organisation can still choose to let AI answer.
    await configureVoiceProvider(owner.id, organisation.id, { exhaustedMinutesBehavior: "AI_ANYWAY" });
    const { call: graceCall, routing: graceRouting } = await startInboundCall({ toNumber: "+233210000012", fromNumber: "+233240110017" });
    expect(graceRouting?.requiresHandoff).toBe(false);
    expect(graceCall.aiEmployeeId).toBeTruthy();
  });

  it("races two concurrent outbound call placements against a concurrency limit of one and lets only one through, without a real call ever going untracked", async () => {
    const owner = await registerUser({ displayName: "Concurrency Owner", email: "concurrency-owner@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Concurrency Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await scalePropertyOsOrg(organisation.id);
    await configureVoiceProvider(owner.id, organisation.id, { phoneNumber: "+233210000013", outboundEnabled: true, maxOutboundCallsPerDay: 100, ...wideHours });
    await createTenant(owner.id, organisation.id, { legalName: "Race Tenant A", email: "race-tenant-a@example.com", phone: "+233240110018" });
    await createTenant(owner.id, organisation.id, { legalName: "Race Tenant B", email: "race-tenant-b@example.com", phone: "+233240110019" });
    const tenantA = await db.tenantOrganisation.findFirstOrThrow({ where: { organisationId: organisation.id, phone: "+233240110018" } });
    const tenantB = await db.tenantOrganisation.findFirstOrThrow({ where: { organisationId: organisation.id, phone: "+233240110019" } });

    // Scale's own default concurrency ceiling (25) is too high to demonstrate a race in two
    // calls — an organisation-scoped override (the real production mechanism for a custom
    // per-org limit) narrows it to exactly one for this test.
    const platformAdmin = await registerUser({ displayName: "Concurrency Platform Admin", email: "concurrency-platform-admin@example.com", password: "secure-password-123" });
    const principal = await db.platformPrincipal.create({ data: { userId: platformAdmin.id, role: "SUPER_ADMIN", status: "ACTIVE", createdVia: "MANUAL" } });
    await createEntitlementOverride(principal, organisation.id, { featureKey: "propertyos.voice.concurrent_calls_max", kind: "LIMIT", limitValue: 1, isUnlimited: false, reason: "Phase 22C concurrency race test" });

    const results = await Promise.allSettled([
      placeOutboundTenantCall(owner.id, organisation.id, { tenantOrganisationId: tenantA.id, purpose: "LEASE_EXPIRY_REMINDER" }),
      placeOutboundTenantCall(owner.id, organisation.id, { tenantOrganisationId: tenantB.id, purpose: "LEASE_EXPIRY_REMINDER" }),
    ]);
    const succeeded = results.filter((result) => result.status === "fulfilled");
    const failed = results.filter((result) => result.status === "rejected");
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0] as PromiseRejectedResult).reason).toMatchObject({ code: "VOICE_CONCURRENCY_LIMIT_REACHED" });

    // The DB reflects exactly the one real call that was allowed through — no untracked/duplicate rows.
    const liveCallCount = await db.voiceCall.count({ where: { organisationId: organisation.id, direction: "OUTBOUND" } });
    expect(liveCallCount).toBe(1);
  });

  it("reports honest voice health status (never READY on telephony credentials alone) and real operational metrics with audit attribution for STT/TTS failures", async () => {
    const owner = await registerUser({ displayName: "Health Owner", email: "health-owner@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Health Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await scalePropertyOsOrg(organisation.id);
    await configureVoiceProvider(owner.id, organisation.id, { phoneNumber: "+233210000014", inboundEnabled: true, ...wideHours });
    await updateAutonomyConfiguration(owner.id, organisation.id, { enabled: true, defaultLevel: "RECOMMEND_ONLY", communicationAllowed: true });
    await createAIEmployee(owner.id, organisation.id, { name: "Health Receptionist", role: "RECEPTIONIST", scope: "ORGANISATION", toolPermissions: [], instructions: {}, escalationConfiguration: {} });

    // No real telephony/STT/TTS credentials exist anywhere in this test environment.
    const health = await getVoiceHealthStatus(owner.id, organisation.id);
    expect(health.status).toBe("MOCK_TEST");
    expect(health.telephonyReal).toBe(false);

    const { call } = await startInboundCall({ toNumber: "+233210000014", fromNumber: "+233240110020" });
    await beginRealtimeSession(call.id);

    // Deterministic STT-outage trigger — fails safely (a handoff, never dead air), and is
    // observable/attributed via the audit trail (item 13/16), never logging transcript content.
    const { submitCallerAudioChunk } = await import("@/modules/voice/service");
    const sttFailure = await submitCallerAudioChunk(call.id, { simulatedText: "__STT_FAIL__", isFinalChunk: true });
    expect(sttFailure.status).toBe("HANDED_OFF");
    // Attributed to the right organisation/call, and only the adapter's own safe error message is
    // stored — never the caller's audio or transcript content (there is none to store here: STT
    // never returned text on this failure path at all).
    const sttAudit = await db.auditEvent.findFirst({ where: { organisationId: organisation.id, action: "voice.stt_failed", entityId: call.id } });
    expect(sttAudit).toBeTruthy();
    expect(sttAudit?.entityType).toBe("voice_call");

    // Deterministic TTS-outage trigger via a persona voice profile.
    const { call: call2 } = await startInboundCall({ toNumber: "+233210000014", fromNumber: "+233240110021" });
    await beginRealtimeSession(call2.id);
    if (call2.aiEmployeeId) await setVoicePersonaConfig(owner.id, organisation.id, call2.aiEmployeeId, { voiceProfileId: "__TTS_FAIL__", language: "en", supportedLanguages: ["en"] });
    const ttsFailure = await submitCallerAudioChunk(call2.id, { simulatedText: "hello", isFinalChunk: true });
    expect(ttsFailure.status).toBe("HANDED_OFF");
    expect(await db.auditEvent.count({ where: { organisationId: organisation.id, action: "voice.tts_failed" } })).toBe(1);

    const snapshot = await getVoiceOperationalSnapshot(owner.id, organisation.id);
    expect(snapshot.sttFailures).toBe(1);
    expect(snapshot.ttsFailures).toBe(1);
    expect(snapshot.handoffs).toBeGreaterThanOrEqual(2);
  });

  it("falls back to the deterministic keyword router when no real AI provider is configured (the only state this environment ever has) without ever blocking the call", async () => {
    const owner = await registerUser({ displayName: "Fallback Owner", email: "fallback-owner@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Fallback Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await scalePropertyOsOrg(organisation.id);
    await configureVoiceProvider(owner.id, organisation.id, { phoneNumber: "+233210000015", inboundEnabled: true, ...wideHours });
    await updateAutonomyConfiguration(owner.id, organisation.id, { enabled: true, defaultLevel: "RECOMMEND_ONLY", communicationAllowed: true });
    await createAIEmployee(owner.id, organisation.id, { name: "Fallback Receptionist", role: "RECEPTIONIST", scope: "ORGANISATION", toolPermissions: ["tenants.history"], instructions: {}, escalationConfiguration: {} });
    const { call } = await startInboundCall({ toNumber: "+233210000015", fromNumber: "+233240110022" });

    // `AI_PROVIDER` is never set in this test environment, so `getAIProvider()` always returns
    // `DeterministicAIProvider` — this IS the real fallback path a genuine OpenAI-compatible
    // provider outage would also take (see `classifyVoiceIntent`'s try/catch in service.ts).
    expect(process.env.AI_PROVIDER).toBeFalsy();
    const routed = await routeVoiceTranscript(call.id, "I'd like to speak to a human please.");
    expect(routed.kind).toBe("HANDOFF");
  });

  it("connects voice-minutes usage and the concurrent-call count to the existing entitlement snapshot", async () => {
    const owner = await registerUser({ displayName: "Snapshot Owner", email: "snapshot-owner@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Snapshot Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await scalePropertyOsOrg(organisation.id);
    await configureVoiceProvider(owner.id, organisation.id, { phoneNumber: "+233210000016", inboundEnabled: true, ...wideHours });
    await createAIEmployee(owner.id, organisation.id, { name: "Snapshot Receptionist", role: "RECEPTIONIST", scope: "ORGANISATION", toolPermissions: [], instructions: {}, escalationConfiguration: {} });
    const { call } = await startInboundCall({ toNumber: "+233210000016", fromNumber: "+233240110023" });

    const snapshot = await getEntitlementSnapshot(organisation.id);
    const concurrent = snapshot.features.find((feature) => feature.featureKey === "propertyos.voice.concurrent_calls_max");
    expect(concurrent?.current).toBe(1); // the call just placed, live right now

    await db.voiceCall.update({ where: { id: call.id }, data: { status: "COMPLETED", durationSeconds: 90, endedAt: new Date() } });
    const after = await getEntitlementSnapshot(organisation.id);
    expect(after.features.find((feature) => feature.featureKey === "propertyos.voice.concurrent_calls_max")?.current).toBe(0);
    expect(after.features.find((feature) => feature.featureKey === "propertyos.voice.inbound_minutes_monthly_max")?.current).toBe(2);
  });
});
