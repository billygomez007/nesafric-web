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
import {
  buildTwilioCallRequest,
  computeTwilioSignature,
  voiceProviders,
  signMockVoiceWebhook,
  type TwilioVoiceProviderAdapter,
} from "@/modules/voice/provider";
import {
  configureVoiceProvider,
  startInboundCall,
  proposeAndCallArtisan,
  recordArtisanCallResponse,
  autoEscalateArtisanDispatch,
  transferCallToHuman,
  sendCallDigits,
  beginRealtimeSession,
  submitCallerAudioChunk,
  finishAISpeaking,
  checkCallSilence,
  handleCallerDisconnect,
  routeVoiceTranscript,
  getCallTranscriptTurns,
  getCallRealtimeSession,
  getVoiceCall,
  ingestProviderWebhook,
} from "@/modules/voice/service";
import { createPhoneNumber, updatePhoneNumber, resolvePhoneNumberRouting } from "@/modules/voice/phone-numbers";
import { getVoicePersonaConfig, setVoicePersonaConfig } from "@/modules/voice/persona";
import { getEntitlementSnapshot } from "@/modules/entitlements/service";
import { proposeDispatch } from "@/modules/maintenance-dispatch/service";

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

describe("PostgreSQL Phase 22B real-time telephony + speech AI", () => {
  beforeEach(cleanDatabase);
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("constructs a real Twilio outbound-call request and webhook signature without needing live credentials", () => {
    const config = { accountSid: "ACtest", authToken: "test-token", apiBaseUrl: "https://api.twilio.com" };
    const built = buildTwilioCallRequest(config, { toNumber: "+233240000001", fromNumber: "+233200000001" }, "https://app.example.com/api/webhooks/voice/TWILIO");
    expect(built.method).toBe("POST");
    expect(built.url).toBe("https://api.twilio.com/2010-04-01/Accounts/ACtest/Calls.json");
    expect(built.body).toContain("To=%2B233240000001");
    expect(built.headers.authorization).toContain("Basic ");

    const signature = computeTwilioSignature("test-token", "https://app.example.com/webhook", { CallSid: "CA1", CallStatus: "completed" });
    expect(signature).toHaveLength(28); // base64(SHA1) is always 28 chars including padding
    const twilio = voiceProviders.get("TWILIO") as TwilioVoiceProviderAdapter;
    expect(twilio.isConfigured()).toBe(false); // no TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN in this environment
    expect(twilio.capabilities).toMatchObject({ mediaStreaming: true, dtmf: true, transfer: true });
  });

  it("normalizes a Twilio-shaped webhook payload into the common event shape used by ingestProviderWebhook", () => {
    const twilio = voiceProviders.get("TWILIO") as TwilioVoiceProviderAdapter;
    const body = new URLSearchParams({ CallSid: "CA123", CallStatus: "completed", CallDuration: "42" }).toString();
    const normalized = twilio.normalizeWebhookPayload(body);
    expect(normalized).toMatchObject({ externalEventId: "CA123:completed", type: "call.completed", providerCallId: "CA123", durationSeconds: 42 });
  });

  it("manages phone-number assignment: create, update, resolve routing, and organisation isolation", async () => {
    const owner = await registerUser({ displayName: "Phone Number Owner", email: "phone-number-owner@example.com", password: "secure-password-123" });
    const other = await registerUser({ displayName: "Phone Number Other", email: "phone-number-other@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Phone Number Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const otherOrg = await createOrganisation(other.id, { name: "Phone Number Other Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await scalePropertyOsOrg(organisation.id);
    await scalePropertyOsOrg(otherOrg.id);

    const created = await createPhoneNumber(owner.id, organisation.id, { e164Number: "+233209990001", purpose: "SALES", label: "Sales line", inboundEnabled: true });
    expect(created.organisationId).toBe(organisation.id);

    const routed = await resolvePhoneNumberRouting("MOCK", "+233209990001");
    expect(routed?.organisationId).toBe(organisation.id);
    expect(routed?.purpose).toBe("SALES");

    const updated = await updatePhoneNumber(owner.id, organisation.id, created.id, { status: "INACTIVE" });
    expect(updated.status).toBe("INACTIVE");
    expect(await resolvePhoneNumberRouting("MOCK", "+233209990001")).toBeNull(); // inactive numbers do not route

    await expect(updatePhoneNumber(other.id, otherOrg.id, created.id, { status: "ACTIVE" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("routes an inbound call through the granular PhoneNumber table, falling back to the legacy single-number config when no row matches", async () => {
    const owner = await registerUser({ displayName: "Phone Routing Landlord", email: "phone-routing-landlord@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Phone Routing Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await scalePropertyOsOrg(organisation.id);
    await configureVoiceProvider(owner.id, organisation.id, { inboundEnabled: true, ...wideHours });
    await createAIEmployee(owner.id, organisation.id, { name: "Routing Receptionist", role: "RECEPTIONIST", scope: "ORGANISATION", toolPermissions: [], instructions: {}, escalationConfiguration: {} });
    await createPhoneNumber(owner.id, organisation.id, { e164Number: "+233209990002", purpose: "GENERAL_OFFICE", inboundEnabled: true });

    const { call, routing } = await startInboundCall({ toNumber: "+233209990002", fromNumber: "+233240099001" });
    expect(routing?.requiresHandoff).toBe(false);
    expect(call.organisationId).toBe(organisation.id);
  });

  it("rejects a voice-persona language the organisation's configured speech providers cannot actually deliver, and never lets persona fields affect authorization", async () => {
    const owner = await registerUser({ displayName: "Persona Owner", email: "persona-owner@example.com", password: "secure-password-123" });
    const other = await registerUser({ displayName: "Persona Other", email: "persona-other@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Persona Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const otherOrg = await createOrganisation(other.id, { name: "Persona Other Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await scalePropertyOsOrg(organisation.id);
    await scalePropertyOsOrg(otherOrg.id);
    const employee = await createAIEmployee(owner.id, organisation.id, { name: "Persona Receptionist", role: "RECEPTIONIST", scope: "ORGANISATION", toolPermissions: [], instructions: {}, escalationConfiguration: {} });

    await expect(setVoicePersonaConfig(owner.id, organisation.id, employee.id, { language: "yo", supportedLanguages: ["en", "yo"] })).rejects.toMatchObject({ code: "VOICE_LANGUAGE_NOT_DELIVERABLE" });

    const persona = await setVoicePersonaConfig(owner.id, organisation.id, employee.id, {
      employeeDisplayName: "Ama", greetingScript: "Hello, this is Ama.", language: "en", supportedLanguages: ["en"], escalationPhrase: "Let me get a colleague.",
    });
    expect(persona.language).toBe("en");
    expect(await getVoicePersonaConfig(owner.id, organisation.id, employee.id)).toMatchObject({ employeeDisplayName: "Ama" });

    // Cross-organisation isolation: a persona config lives under one organisation's own AI employee only.
    await expect(getVoicePersonaConfig(other.id, otherOrg.id, employee.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("opens a streaming session idempotently, drives caller audio through STT -> routing -> TTS, and never lets the caller wait for a full recording before the AI responds", async () => {
    const owner = await registerUser({ displayName: "Realtime Owner", email: "realtime-owner@example.com", password: "secure-password-123" });
    const brokerage = await createMarketplaceProfessional(owner.id, { type: "BROKERAGE", displayName: "Realtime Brokerage", countryCode: "GH" });
    await changeMarketplacePlan(owner.id, brokerage.id, { planKey: "marketplace_brokerage" });
    await configureVoiceProvider(owner.id, brokerage.backingOrganisationId, { phoneNumber: "+233209990003", inboundEnabled: true, ...wideHours });
    await createMarketplaceAIEmployee(owner.id, brokerage.id, { name: "Realtime Ama", role: "AI_SALES_RECEPTIONIST", instructions: {}, escalationConfiguration: {} });
    const listing = await createNativeListing(owner.id, brokerage.id);
    await publishListing(owner.id, brokerage.backingOrganisationId, listing.id);

    const { call } = await startInboundCall({ toNumber: "+233209990003", fromNumber: "+233240099002" });

    const first = await beginRealtimeSession(call.id);
    expect(first.status).toBe("ACTIVE");
    const second = await beginRealtimeSession(call.id); // idempotent
    expect(second.id).toBe(first.id);

    // A partial (non-final) chunk never triggers routing/TTS — the caller is never made to wait.
    const partial = await submitCallerAudioChunk(call.id, { simulatedText: "Is the two-bedroom", isFinalChunk: false });
    expect(partial.status).toBe("LISTENING");

    const final = await submitCallerAudioChunk(call.id, { simulatedText: " property in East Legon still available?", isFinalChunk: true });
    expect(final.status).toBe("AI_SPEAKING");
    expect(final.kind).toBe("AVAILABILITY");
    expect(final.responseText).toContain("available");
    expect(final.audioRef).toContain("mock-audio://");

    const call1 = await db.voiceCall.findUniqueOrThrow({ where: { id: call.id } });
    expect(call1.ttsCharactersUsed).toBeGreaterThan(0);
    expect(call1.sttSecondsUsed).toBeGreaterThan(0);

    await finishAISpeaking(call.id);
    const session = await getCallRealtimeSession(call.id);
    expect(session?.state).toBe("LISTENING");

    const turns = await getCallTranscriptTurns(call.id);
    expect(turns.some((turn) => turn.speaker === "CALLER")).toBe(true);
    expect(turns.some((turn) => turn.speaker === "AI")).toBe(true);
  });

  it("handles barge-in: caller audio arriving while the AI is still speaking interrupts the in-progress AI turn", async () => {
    const owner = await registerUser({ displayName: "Bargein Owner", email: "bargein-owner@example.com", password: "secure-password-123" });
    const brokerage = await createMarketplaceProfessional(owner.id, { type: "BROKERAGE", displayName: "Bargein Brokerage", countryCode: "GH" });
    await changeMarketplacePlan(owner.id, brokerage.id, { planKey: "marketplace_brokerage" });
    await configureVoiceProvider(owner.id, brokerage.backingOrganisationId, { phoneNumber: "+233209990004", inboundEnabled: true, ...wideHours });
    await createMarketplaceAIEmployee(owner.id, brokerage.id, { name: "Bargein Ama", role: "AI_SALES_RECEPTIONIST", instructions: {}, escalationConfiguration: {} });
    const listing = await createNativeListing(owner.id, brokerage.id);
    await publishListing(owner.id, brokerage.backingOrganisationId, listing.id);
    const { call } = await startInboundCall({ toNumber: "+233209990004", fromNumber: "+233240099003" });
    await beginRealtimeSession(call.id);

    await submitCallerAudioChunk(call.id, { simulatedText: "Is the two-bedroom in East Legon available?", isFinalChunk: true });
    expect((await getCallRealtimeSession(call.id))?.state).toBe("AI_SPEAKING");

    const interrupted = await submitCallerAudioChunk(call.id, { simulatedText: "actually wait", isFinalChunk: false });
    expect(interrupted.bargeIn).toBe(true);

    const turns = await getCallTranscriptTurns(call.id);
    const aiTurn = turns.find((turn) => turn.speaker === "AI");
    expect(aiTurn?.interrupted).toBe(true);
    expect(aiTurn?.endedAt).toBeTruthy();
  });

  it("detects silence, prompts once, then disconnects on a second consecutive timeout, closing the streaming session and completing the call", async () => {
    const owner = await registerUser({ displayName: "Silence Owner", email: "silence-owner@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Silence Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await scalePropertyOsOrg(organisation.id);
    await configureVoiceProvider(owner.id, organisation.id, { phoneNumber: "+233209990005", inboundEnabled: true, ...wideHours });
    await createAIEmployee(owner.id, organisation.id, { name: "Silence Receptionist", role: "RECEPTIONIST", scope: "ORGANISATION", toolPermissions: [], instructions: {}, escalationConfiguration: {} });
    const { call } = await startInboundCall({ toNumber: "+233209990005", fromNumber: "+233240099004" });
    await beginRealtimeSession(call.id);
    await db.voiceStreamingSession.update({ where: { callId: call.id }, data: { silenceTimeoutSeconds: 5 } });

    const notYet = await checkCallSilence(call.id, new Date(Date.now() + 2_000));
    expect(notYet.timedOut).toBe(false);

    const prompted = await checkCallSilence(call.id, new Date(Date.now() + 6_000));
    expect(prompted).toMatchObject({ timedOut: true, action: "PROMPT" });
    expect((await getCallRealtimeSession(call.id))?.state).toBe("SILENCE_WARNING");

    const disconnected = await checkCallSilence(call.id, new Date(Date.now() + 12_000));
    expect(disconnected).toMatchObject({ timedOut: true, action: "DISCONNECT" });
    const session = await getCallRealtimeSession(call.id);
    expect(session?.status).toBe("TIMED_OUT");
    const finalCall = await db.voiceCall.findUniqueOrThrow({ where: { id: call.id } });
    expect(finalCall.status).toBe("COMPLETED");

    // Idempotent: disconnecting an already-closed session/call is a safe no-op.
    await expect(handleCallerDisconnect(call.id)).resolves.toMatchObject({ closed: true });
  });

  it("rejects reopening a streaming session that already ended, and rejects feeding transcript into a non-existent session", async () => {
    const owner = await registerUser({ displayName: "Session Owner", email: "session-owner@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Session Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await scalePropertyOsOrg(organisation.id);
    await configureVoiceProvider(owner.id, organisation.id, { phoneNumber: "+233209990006", inboundEnabled: true, ...wideHours });
    await createAIEmployee(owner.id, organisation.id, { name: "Session Receptionist", role: "RECEPTIONIST", scope: "ORGANISATION", toolPermissions: [], instructions: {}, escalationConfiguration: {} });
    const { call } = await startInboundCall({ toNumber: "+233209990006", fromNumber: "+233240099005" });

    await expect(submitCallerAudioChunk(call.id, { simulatedText: "hello", isFinalChunk: true })).rejects.toMatchObject({ code: "NOT_FOUND" });

    await beginRealtimeSession(call.id);
    await handleCallerDisconnect(call.id);
    await expect(beginRealtimeSession(call.id)).rejects.toMatchObject({ code: "VOICE_STREAMING_SESSION_ENDED" });
  });

  it("routes tenant private-data requests deterministically: denies before identity verification, answers after", async () => {
    const owner = await registerUser({ displayName: "Route Tenant Landlord", email: "route-tenant-landlord@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Route Tenant Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await scalePropertyOsOrg(organisation.id);
    await configureVoiceProvider(owner.id, organisation.id, { phoneNumber: "+233209990007", inboundEnabled: true, ...wideHours });
    await updateAutonomyConfiguration(owner.id, organisation.id, { enabled: true, defaultLevel: "RECOMMEND_ONLY", communicationAllowed: true });
    await createAIEmployee(owner.id, organisation.id, { name: "Route Receptionist", role: "RECEPTIONIST", scope: "ORGANISATION", toolPermissions: ["tenants.history"], instructions: {}, escalationConfiguration: {} });
    await createTenant(owner.id, organisation.id, { legalName: "Route Tenant", email: "route-tenant@example.com", phone: "+233240099006" });

    const { call } = await startInboundCall({ toNumber: "+233209990007", fromNumber: "+233240099006" });
    const denied = await routeVoiceTranscript(call.id, "What's my current rent balance?");
    expect(denied.kind).toBe("IDENTITY_REQUIRED");

    await db.voiceCall.update({ where: { id: call.id }, data: { callerIdentityLevel: "VERIFIED" } });
    await db.conversation.update({ where: { id: call.conversationId }, data: { identityLevel: "VERIFIED", tenantOrganisationId: (await db.tenantOrganisation.findFirstOrThrow({ where: { organisationId: organisation.id } })).id } });
    const allowed = await routeVoiceTranscript(call.id, "What's my current rent balance?");
    expect(allowed.kind).toBe("TENANT_SUMMARY");
  });

  it("routes and classifies a spoken maintenance report by category (AC / electrical / plumbing) and creates the underlying request via the existing autonomy-gated pipeline", async () => {
    const owner = await registerUser({ displayName: "Route Maintenance Landlord", email: "route-maintenance-landlord@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Route Maintenance Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await scalePropertyOsOrg(organisation.id);
    await configureVoiceProvider(owner.id, organisation.id, { phoneNumber: "+233209990008", inboundEnabled: true, ...wideHours });
    await updateAutonomyConfiguration(owner.id, organisation.id, { enabled: true, defaultLevel: "RECOMMEND_ONLY", communicationAllowed: true });
    const property = await createProperty(owner.id, organisation.id, { name: "Route Maintenance House", referenceNumber: "RMH-1", category: "Residential", countryCode: "GH", currencyCode: "GHS" });
    const policy = await upsertAutonomyPolicy(owner.id, organisation.id, { actionKey: "maintenance.create", enabled: true, level: "APPROVAL_REQUIRED", propertyId: property.id, timezone: "UTC" });
    await createAIEmployee(owner.id, organisation.id, { name: "Route Maintenance Receptionist", role: "RECEPTIONIST", scope: "ORGANISATION", toolPermissions: ["maintenance.create"], autonomyPolicyIds: [policy.id], instructions: {}, escalationConfiguration: {} });

    const scenarios: Array<[string, string]> = [
      ["My air conditioner is not working and it's blowing warm air.", "air conditioning"],
      ["There's an electrical problem, the lights keep tripping.", "electrical"],
      ["There is a leak under the kitchen sink and water everywhere.", "plumbing"],
    ];
    let seq = 0;
    for (const [transcript, expectedCategory] of scenarios) {
      seq += 1;
      const { call } = await startInboundCall({ toNumber: "+233209990008", fromNumber: `+23324009910${seq}` });
      await db.conversation.update({ where: { id: call.conversationId }, data: { propertyId: property.id } });
      const routed = await routeVoiceTranscript(call.id, transcript);
      expect(routed.kind).toBe("MAINTENANCE");
      const activity = routed.data as { id: string; type: string; status: string; result: { proposalId: string } };
      expect(activity).toMatchObject({ type: "PROPOSAL", status: "PENDING" });
      // The queued proposal records exactly the category this deterministic classifier assigned —
      // never a free-text guess passed straight through the strict category enum.
      const proposal = await db.aIActionProposal.findUniqueOrThrow({ where: { id: activity.result.proposalId } });
      expect((proposal.arguments as Record<string, unknown>).category).toBe(expectedCategory);
    }
  });

  it("automatically escalates a declined artisan dispatch to backup, is idempotent when called again with nothing new to escalate, and is bounded", async () => {
    const owner = await registerUser({ displayName: "Escalation Landlord", email: "escalation-landlord@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Escalation Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await scalePropertyOsOrg(organisation.id);
    await configureVoiceProvider(owner.id, organisation.id, { phoneNumber: "+233209990009", outboundEnabled: true, retryDelaySeconds: 900, ...wideHours });
    const property = await createProperty(owner.id, organisation.id, { name: "Escalation House", referenceNumber: "ESC-1", category: "Residential", countryCode: "GH", currencyCode: "GHS" });
    const plumbingCategory = await db.serviceCategory.findUniqueOrThrow({ where: { key: "plumbing" } });

    async function verifiedProvider(email: string, displayName: string, phone: string) {
      const user = await registerUser({ displayName, email, password: "secure-password-123" });
      const provider = await createServiceProvider(user.id, { type: "INDIVIDUAL", displayName, contactEmail: email, categoryIds: [plumbingCategory.id] });
      await db.serviceProvider.update({ where: { id: provider.id }, data: { verificationStatus: "VERIFIED", acceptingWork: true, availabilityStatus: "AVAILABLE", contactPhone: phone } });
      return provider;
    }
    const preferred = await verifiedProvider("escalation-preferred@example.com", "Escalation Preferred", "+233240099010");
    const backup = await verifiedProvider("escalation-backup@example.com", "Escalation Backup", "+233240099011");
    await addProviderToDirectory(owner.id, organisation.id, { providerId: preferred.id });
    await db.providerOrganisation.updateMany({ where: { providerId: preferred.id }, data: { priority: 10 } });
    await addProviderToDirectory(owner.id, organisation.id, { providerId: backup.id });
    await db.providerOrganisation.updateMany({ where: { providerId: backup.id }, data: { isBackup: true } });

    const request = await createMaintenanceRequest(owner.id, organisation.id, { propertyId: property.id, title: "Escalation leak", description: "Kitchen pipe leaking.", category: "plumbing" });
    await transitionMaintenanceRequest(owner.id, organisation.id, request.id, { status: "TRIAGED" });
    const workOrder = await createWorkOrder(owner.id, organisation.id, request.id, { title: "Fix escalation leak", currencyCode: "GHS" });

    // Nothing to escalate yet.
    await expect(autoEscalateArtisanDispatch(owner.id, organisation.id, workOrder.id)).rejects.toMatchObject({ code: "VOICE_NO_DISPATCH_ATTEMPT" });

    const call = await proposeAndCallArtisan(owner.id, organisation.id, { workOrderId: workOrder.id });
    await recordArtisanCallResponse(owner.id, organisation.id, call.id, { response: "UNAVAILABLE" });

    // The configured retry delay has not elapsed yet.
    const tooSoon = await autoEscalateArtisanDispatch(owner.id, organisation.id, workOrder.id);
    expect(tooSoon).toMatchObject({ escalated: false, reason: "retry_delay_not_elapsed" });

    // Backdate the response so the retry delay has "elapsed" without a real sleep.
    const attempt = await db.maintenanceDispatchAttempt.findFirstOrThrow({ where: { workOrderId: workOrder.id }, orderBy: { createdAt: "desc" } });
    await db.maintenanceDispatchAttempt.update({ where: { id: attempt.id }, data: { respondedAt: new Date(Date.now() - 3_600_000) } });

    const escalated = await autoEscalateArtisanDispatch(owner.id, organisation.id, workOrder.id);
    expect(escalated.escalated).toBe(true);
    if (escalated.escalated) expect(escalated.call.toNumber).toBe("+233240099011");

    // Idempotent / loop-prevention: calling again immediately (latest attempt is no longer BACKUP_REQUIRED) is a no-op.
    const again = await autoEscalateArtisanDispatch(owner.id, organisation.id, workOrder.id);
    expect(again).toMatchObject({ escalated: false, reason: "not_pending_escalation" });
    expect(await db.maintenanceDispatchAttempt.count({ where: { workOrderId: workOrder.id } })).toBe(2);
  });

  it("escalates automatically to backup when the preferred artisan's call fails outright (no-response), and falls back to the NesAfric marketplace once internal providers are exhausted", async () => {
    const owner = await registerUser({ displayName: "Fallback Escalation Landlord", email: "fallback-escalation-landlord@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Fallback Escalation Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await scalePropertyOsOrg(organisation.id);
    await configureVoiceProvider(owner.id, organisation.id, { phoneNumber: "+233209990018", outboundEnabled: true, retryDelaySeconds: 900, ...wideHours });
    const property = await createProperty(owner.id, organisation.id, { name: "Fallback Escalation House", referenceNumber: "FEH-1", category: "Residential", countryCode: "GH", currencyCode: "GHS" });
    const electricalCategory = await db.serviceCategory.findUniqueOrThrow({ where: { key: "electrical" } });

    const preferredUser = await registerUser({ displayName: "Unreachable Electrician", email: "unreachable-electrician@example.com", password: "secure-password-123" });
    const preferred = await createServiceProvider(preferredUser.id, { type: "INDIVIDUAL", displayName: "Unreachable Electrician", contactEmail: "unreachable-electrician@example.com", categoryIds: [electricalCategory.id] });
    await db.serviceProvider.update({ where: { id: preferred.id }, data: { verificationStatus: "VERIFIED", acceptingWork: true, availabilityStatus: "AVAILABLE", contactPhone: "+0000000099" } });
    await addProviderToDirectory(owner.id, organisation.id, { providerId: preferred.id });

    const outsideUser = await registerUser({ displayName: "Fallback Electrician", email: "fallback-electrician@example.com", password: "secure-password-123" });
    const outsideProvider = await createServiceProvider(outsideUser.id, { type: "INDIVIDUAL", displayName: "Fallback Electrician", contactEmail: "fallback-electrician@example.com", categoryIds: [electricalCategory.id] });
    await db.serviceProvider.update({ where: { id: outsideProvider.id }, data: { verificationStatus: "VERIFIED", acceptingWork: true, availabilityStatus: "AVAILABLE", contactPhone: "+233240099012" } });

    const request = await createMaintenanceRequest(owner.id, organisation.id, { propertyId: property.id, title: "Fallback outage", description: "Power keeps tripping.", category: "electrical" });
    await transitionMaintenanceRequest(owner.id, organisation.id, request.id, { status: "TRIAGED" });
    const workOrder = await createWorkOrder(owner.id, organisation.id, request.id, { title: "Inspect fallback outage", currencyCode: "GHS" });

    // The call to the only internal (preferred) provider fails outright — a real provider outage,
    // never fabricated as a successful contact — which auto-records NO_RESPONSE.
    const call = await proposeAndCallArtisan(owner.id, organisation.id, { workOrderId: workOrder.id });
    expect(call.status).toBe("FAILED");
    const attempt = await db.maintenanceDispatchAttempt.findFirstOrThrow({ where: { workOrderId: workOrder.id } });
    expect(attempt.status).toBe("BACKUP_REQUIRED");
    await db.maintenanceDispatchAttempt.update({ where: { id: attempt.id }, data: { respondedAt: new Date(Date.now() - 3_600_000) } });

    // No internal backup exists — auto-escalation must reach the marketplace fallback tier itself.
    const escalated = await autoEscalateArtisanDispatch(owner.id, organisation.id, workOrder.id);
    expect(escalated.escalated).toBe(true);
    if (escalated.escalated) {
      expect(escalated.attempt.tier).toBe("MARKETPLACE_FALLBACK");
      expect(escalated.call.toNumber).toBe("+233240099012");
    }
  });

  it("transfers a call live to a human when the provider supports it and the entitlement allows it, and denies transfer on a plan without it", async () => {
    const owner = await registerUser({ displayName: "Transfer Owner", email: "transfer-owner@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Transfer Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await scalePropertyOsOrg(organisation.id);
    await configureVoiceProvider(owner.id, organisation.id, { phoneNumber: "+233209990010", inboundEnabled: true, ...wideHours });
    await updateAutonomyConfiguration(owner.id, organisation.id, { enabled: true, defaultLevel: "RECOMMEND_ONLY", communicationAllowed: true });
    await createAIEmployee(owner.id, organisation.id, { name: "Transfer Receptionist", role: "RECEPTIONIST", scope: "ORGANISATION", toolPermissions: [], instructions: {}, escalationConfiguration: {} });
    const { call } = await startInboundCall({ toNumber: "+233209990010", fromNumber: "+233240099013" });

    const transferred = await transferCallToHuman(call.id, { toNumber: "+233240099099" }) as { transferStatus: string; transferTargetNumber: string | null };
    expect(transferred.transferStatus).toBe("CONNECTED");
    expect(transferred.transferTargetNumber).toBe("+233240099099");
    const detail = await getVoiceCall(owner.id, organisation.id, call.id);
    expect(detail.handoff).toBeTruthy();

    // A provider outage on the transfer target itself (deterministic +000 trigger) is reported as a failure, never as success.
    const { call: failCall } = await startInboundCall({ toNumber: "+233209990010", fromNumber: "+233240099014" });
    const failedTransfer = await transferCallToHuman(failCall.id, { toNumber: "+000000000000" }) as { transferStatus: string };
    expect(failedTransfer.transferStatus).toBe("FAILED");

    // Growth plan lacks `propertyos.voice.human_transfer_enabled`.
    const growthOwner = await registerUser({ displayName: "Growth Transfer Owner", email: "growth-transfer-owner@example.com", password: "secure-password-123" });
    const growthOrg = await createOrganisation(growthOwner.id, { name: "Growth Transfer Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await db.organisationSubscription.update({ where: { organisationId: growthOrg.id }, data: { plan: { connect: { key: "growth" } } } });
    await configureVoiceProvider(growthOwner.id, growthOrg.id, { phoneNumber: "+233209990011", inboundEnabled: true, ...wideHours });
    await createAIEmployee(growthOwner.id, growthOrg.id, { name: "Growth Receptionist", role: "RECEPTIONIST", scope: "ORGANISATION", toolPermissions: [], instructions: {}, escalationConfiguration: {} });
    const { call: growthCall } = await startInboundCall({ toNumber: "+233209990011", fromNumber: "+233240099015" });
    await expect(transferCallToHuman(growthCall.id, { toNumber: "+233240099099" })).rejects.toMatchObject({ code: "ENTITLEMENT_FEATURE_DISABLED" });
  });

  it("sends DTMF digits where the provider supports it, and reports a deterministic send failure honestly", async () => {
    const owner = await registerUser({ displayName: "Digits Owner", email: "digits-owner@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Digits Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await scalePropertyOsOrg(organisation.id);
    await configureVoiceProvider(owner.id, organisation.id, { phoneNumber: "+233209990012", inboundEnabled: true, ...wideHours });
    await createAIEmployee(owner.id, organisation.id, { name: "Digits Receptionist", role: "RECEPTIONIST", scope: "ORGANISATION", toolPermissions: [], instructions: {}, escalationConfiguration: {} });
    const { call } = await startInboundCall({ toNumber: "+233209990012", fromNumber: "+233240099016" });

    const sent = await sendCallDigits(call.id, { digits: "1234#" });
    expect(sent.status).toBe("OK");

    // A provider that can no longer reach the call reports the send as a real failure, never a
    // false success (deterministic `_unreachable` suffix trigger, same convention as terminate/transfer).
    await db.voiceCall.update({ where: { id: call.id }, data: { providerCallId: `${call.providerCallId}_unreachable` } });
    const failed = await sendCallDigits(call.id, { digits: "5678" });
    expect(failed).toMatchObject({ status: "FAILED" });
  });

  it("connects real voice minutes usage to the existing entitlement/usage architecture", async () => {
    const owner = await registerUser({ displayName: "Usage Owner", email: "usage-owner@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Usage Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await scalePropertyOsOrg(organisation.id);
    await configureVoiceProvider(owner.id, organisation.id, { phoneNumber: "+233209990013", inboundEnabled: true, ...wideHours });
    await createAIEmployee(owner.id, organisation.id, { name: "Usage Receptionist", role: "RECEPTIONIST", scope: "ORGANISATION", toolPermissions: [], instructions: {}, escalationConfiguration: {} });
    const { call } = await startInboundCall({ toNumber: "+233209990013", fromNumber: "+233240099017" });
    await db.voiceCall.update({ where: { id: call.id }, data: { status: "COMPLETED", durationSeconds: 185, endedAt: new Date() } });

    const snapshot = await getEntitlementSnapshot(organisation.id);
    const inboundMinutes = snapshot.features.find((feature) => feature.featureKey === "propertyos.voice.inbound_minutes_monthly_max");
    expect(inboundMinutes?.current).toBe(4); // ceil(185s / 60) = 4 minutes, never fabricated
  });

  it("keeps voice realtime state fully isolated across organisations", async () => {
    const ownerA = await registerUser({ displayName: "Isolation Owner A", email: "isolation-owner-a2@example.com", password: "secure-password-123" });
    const ownerB = await registerUser({ displayName: "Isolation Owner B", email: "isolation-owner-b2@example.com", password: "secure-password-123" });
    const orgA = await createOrganisation(ownerA.id, { name: "Isolation Org A2", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    const orgB = await createOrganisation(ownerB.id, { name: "Isolation Org B2", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await scalePropertyOsOrg(orgA.id);
    await scalePropertyOsOrg(orgB.id);
    await configureVoiceProvider(ownerA.id, orgA.id, { phoneNumber: "+233209990014", inboundEnabled: true, ...wideHours });
    await createAIEmployee(ownerA.id, orgA.id, { name: "Isolation Receptionist A", role: "RECEPTIONIST", scope: "ORGANISATION", toolPermissions: [], instructions: {}, escalationConfiguration: {} });
    const { call } = await startInboundCall({ toNumber: "+233209990014", fromNumber: "+233240099018" });
    await beginRealtimeSession(call.id);

    // Org B has no visibility into org A's phone numbers or persona configs.
    expect(await resolvePhoneNumberRouting("MOCK", "+233209990014")).toBeNull(); // never configured via PhoneNumber table, legacy config only
    await expect(getVoiceCall(ownerB.id, orgB.id, call.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("verifies webhook signature and prevents replay for an inbound call's completion event, and closes the realtime session exactly once", async () => {
    const owner = await registerUser({ displayName: "Webhook Complete Owner", email: "webhook-complete-owner@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Webhook Complete Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await scalePropertyOsOrg(organisation.id);
    await configureVoiceProvider(owner.id, organisation.id, { phoneNumber: "+233209990015", inboundEnabled: true, ...wideHours });
    await createAIEmployee(owner.id, organisation.id, { name: "Webhook Complete Receptionist", role: "RECEPTIONIST", scope: "ORGANISATION", toolPermissions: [], instructions: {}, escalationConfiguration: {} });
    const { call } = await startInboundCall({ toNumber: "+233209990015", fromNumber: "+233240099019", providerCallId: "webhook-complete-call-1" });
    await beginRealtimeSession(call.id);

    const body = JSON.stringify({ externalEventId: "evt-complete-1", type: "call.completed", providerCallId: "webhook-complete-call-1", durationSeconds: 61 });
    const signature = signMockVoiceWebhook(body);
    const first = await ingestProviderWebhook("MOCK", body, { "x-voice-signature": signature });
    expect(first.replay).toBe(false);

    const updated = await db.voiceCall.findUniqueOrThrow({ where: { id: call.id } });
    expect(updated.status).toBe("COMPLETED");
    expect(updated.durationSeconds).toBe(61);
    const session = await getCallRealtimeSession(call.id);
    expect(session?.status).toBe("CLOSED");

    const replay = await ingestProviderWebhook("MOCK", body, { "x-voice-signature": signature });
    expect(replay.replay).toBe(true);
    expect(await db.voiceCallEvent.count({ where: { callId: call.id } })).toBe(1);
  });

  it("keeps dispatch escalation bounded by never proposing a candidate that was already tried, preventing an infinite call loop", async () => {
    const owner = await registerUser({ displayName: "Bounded Landlord", email: "bounded-landlord@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Bounded Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await scalePropertyOsOrg(organisation.id);
    await configureVoiceProvider(owner.id, organisation.id, { phoneNumber: "+233209990016", outboundEnabled: true, retryDelaySeconds: 30, ...wideHours });
    const property = await createProperty(owner.id, organisation.id, { name: "Bounded House", referenceNumber: "BND-1", category: "Residential", countryCode: "GH", currencyCode: "GHS" });
    const plumbingCategory = await db.serviceCategory.findUniqueOrThrow({ where: { key: "plumbing" } });
    const providerUser = await registerUser({ displayName: "Bounded Plumber", email: "bounded-plumber@example.com", password: "secure-password-123" });
    const provider = await createServiceProvider(providerUser.id, { type: "INDIVIDUAL", displayName: "Bounded Plumber", contactEmail: "bounded-plumber@example.com", categoryIds: [plumbingCategory.id] });
    await db.serviceProvider.update({ where: { id: provider.id }, data: { verificationStatus: "VERIFIED", acceptingWork: true, availabilityStatus: "AVAILABLE", contactPhone: "+233240099020" } });
    await addProviderToDirectory(owner.id, organisation.id, { providerId: provider.id });

    const request = await createMaintenanceRequest(owner.id, organisation.id, { propertyId: property.id, title: "Bounded leak", description: "Leak.", category: "plumbing" });
    await transitionMaintenanceRequest(owner.id, organisation.id, request.id, { status: "TRIAGED" });
    const workOrder = await createWorkOrder(owner.id, organisation.id, request.id, { title: "Fix bounded leak", currencyCode: "GHS" });

    const call = await proposeAndCallArtisan(owner.id, organisation.id, { workOrderId: workOrder.id });
    await recordArtisanCallResponse(owner.id, organisation.id, call.id, { response: "UNAVAILABLE" });
    const attempt = await db.maintenanceDispatchAttempt.findFirstOrThrow({ where: { workOrderId: workOrder.id } });
    await db.maintenanceDispatchAttempt.update({ where: { id: attempt.id }, data: { respondedAt: new Date(Date.now() - 3_600_000) } });

    // No backup/marketplace candidate exists at all — escalation must report no provider rather
    // than spinning or fabricating a call.
    const result = await autoEscalateArtisanDispatch(owner.id, organisation.id, workOrder.id);
    expect(result).toMatchObject({ escalated: false, reason: "no_provider_available" });
    expect(await db.voiceCall.count({ where: { organisationId: organisation.id, dispatchAttemptId: { not: null } } })).toBe(1);
  });

  it("keeps proposeDispatch's own entitlement gate intact for a growth-plan organisation even when called via the escalation path", async () => {
    const owner = await registerUser({ displayName: "Growth Escalation Landlord", email: "growth-escalation-landlord@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Growth Escalation Org", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });
    await db.organisationSubscription.update({ where: { organisationId: organisation.id }, data: { plan: { connect: { key: "growth" } } } });
    const property = await createProperty(owner.id, organisation.id, { name: "Growth Escalation House", referenceNumber: "GEH-1", category: "Residential", countryCode: "GH", currencyCode: "GHS" });
    const plumbingCategory = await db.serviceCategory.findUniqueOrThrow({ where: { key: "plumbing" } });
    async function verifiedProvider(email: string, displayName: string, phone: string) {
      const user = await registerUser({ displayName, email, password: "secure-password-123" });
      const provider = await createServiceProvider(user.id, { type: "INDIVIDUAL", displayName, contactEmail: email, categoryIds: [plumbingCategory.id] });
      await db.serviceProvider.update({ where: { id: provider.id }, data: { verificationStatus: "VERIFIED", acceptingWork: true, availabilityStatus: "AVAILABLE", contactPhone: phone } });
      return provider;
    }
    const preferred = await verifiedProvider("growth-escalation-preferred@example.com", "Growth Escalation Preferred", "+233240099021");
    const backup = await verifiedProvider("growth-escalation-backup@example.com", "Growth Escalation Backup", "+233240099022");
    await addProviderToDirectory(owner.id, organisation.id, { providerId: preferred.id });
    await db.providerOrganisation.updateMany({ where: { providerId: preferred.id }, data: { priority: 10 } });
    await addProviderToDirectory(owner.id, organisation.id, { providerId: backup.id });
    await db.providerOrganisation.updateMany({ where: { providerId: backup.id }, data: { isBackup: true } });

    const request = await createMaintenanceRequest(owner.id, organisation.id, { propertyId: property.id, title: "Growth leak", description: "Leak.", category: "plumbing" });
    await transitionMaintenanceRequest(owner.id, organisation.id, request.id, { status: "TRIAGED" });
    const workOrder = await createWorkOrder(owner.id, organisation.id, request.id, { title: "Fix growth leak", currencyCode: "GHS" });
    const attempt = await proposeDispatch(owner.id, organisation.id, { workOrderId: workOrder.id });
    await db.maintenanceDispatchAttempt.update({ where: { id: attempt.id }, data: { status: "BACKUP_REQUIRED", respondedAt: new Date(Date.now() - 3_600_000) } });

    // proposeDispatch itself succeeds on growth (ai_dispatch is enabled there) but the escalation's
    // own outbound-call step still requires `propertyos.maintenance.voice_dispatch`, which growth lacks.
    await expect(autoEscalateArtisanDispatch(owner.id, organisation.id, workOrder.id)).rejects.toMatchObject({ code: "ENTITLEMENT_FEATURE_DISABLED" });
  });
});
