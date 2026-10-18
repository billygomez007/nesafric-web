import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { createProperty } from "@/modules/assets/service";
import { createMaintenanceRequest } from "@/modules/maintenance/service";
import { upsertChannelConfig } from "@/modules/conversations/service";
import { defaultChannelAdapters, type ChannelAdapters } from "@/modules/conversations/channels/registry";
import type { OutboundMessageRequest } from "@/modules/conversations/channels/types";
import { inviteNetworkProvider, respondToInvitation } from "@/modules/provider-network/service";
import { createRoutingRule } from "@/modules/maintenance-routing/rules";
import { getMaintenanceTimeline, manualDispatch, resolveEscalations, stopAutomation } from "@/modules/maintenance-routing/oversight";
import { getMaintenanceTimelineForPlatform, getPlatformHealth, listPortfolioVerificationsForPlatform, reviewPortfolioVerificationForPlatform } from "@/modules/platform-admin/service";
import { createJobHandlers } from "@/platform/jobs/handlers";
import { runDueJobs } from "@/platform/jobs/runner";
import { db } from "@/platform/database/client";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner", "BackgroundJob", "ChannelIdentity", "AuthOtpChallenge" CASCADE');
  await db.tenant.deleteMany();
}

let counter = 0;
const sent: OutboundMessageRequest[] = [];
const adapters: ChannelAdapters = { ...defaultChannelAdapters, WHATSAPP: { ...defaultChannelAdapters.WHATSAPP, channel: "WHATSAPP", send: async (request) => { sent.push(request); return { status: "SENT", providerReference: `wamid.out.${++counter}` }; }, normalizeInbound: () => [], verifyWebhookSignature: () => ({ verified: false }) } };
const work = async (now?: Date) => { await runDueJobs(createJobHandlers(undefined, adapters), now); await runDueJobs(createJobHandlers(undefined, adapters), now); };

async function fixture() {
  const staff = await registerUser({ displayName: "NesAfric Support", email: "support@example.com", password: "secure-password-123" });
  const official = await createOrganisation(staff.id, { name: "NesAfric", type: "OTHER", countryCode: "GH" });
  await upsertChannelConfig(staff.id, official.id, "WHATSAPP", { enabled: true, config: { phoneNumberId: "100200300", marketplaceAssistantEnabled: true } });
  vi.stubEnv("WHATSAPP_OFFICIAL_ORGANISATION_ID", official.id);
  const landlord = await registerUser({ displayName: "Ama Owusu", email: "ama@example.com", password: "secure-password-123" });
  const organisation = await createOrganisation(landlord.id, { name: "Owusu Homes", type: "INDIVIDUAL_LANDLORD", countryCode: "GH" });
  const property = await createProperty(landlord.id, organisation.id, { name: "Palm Court", referenceNumber: "PC-1", category: "Residential", countryCode: "GH", currencyCode: "GHS", units: [{ name: "A1" }] });
  const join = async (name: string, phone: string) => (await respondToInvitation((await inviteNetworkProvider(landlord.id, organisation.id, { displayName: name, phone, scopeCategories: ["plumbing"], autoDispatchAllowed: true })).id, phone, true)).providerOrganisationId!;
  const kwame = await join("Kwame Plumbing", "+233201234567");
  const yaw = await join("Yaw Pipes", "+233241112223");
  await createRoutingRule(landlord.id, organisation.id, { name: "Plumbing", category: "plumbing", primaryProviderOrganisationId: kwame, backupProviderOrganisationIds: [yaw], authorizationMode: "QUOTE_REQUIRED", responseTimeoutMinutes: 30, maxAttempts: 2 });
  const request = await createMaintenanceRequest(landlord.id, organisation.id, { propertyId: property.id, title: "Pipe leaking", description: "Kitchen pipe leaking", category: "plumbing", priority: "URGENT", intakeChannel: "WHATSAPP" }) as { id: string; referenceNumber: string };
  await work();
  const admin = await registerUser({ displayName: "Platform Admin", email: "admin@example.com", password: "secure-password-123" });
  const principal = await db.platformPrincipal.create({ data: { userId: admin.id, role: "SUPPORT_AGENT", status: "ACTIVE", createdVia: "MANUAL" } });
  return { landlord, organisation, property, request, kwame, yaw, principal };
}

describe("PostgreSQL maintenance oversight and manual override", () => {
  beforeEach(async () => {
    vi.stubEnv("WHATSAPP_TEMPLATE_WORK_ORDER", "nesafric_work_order:en");
    sent.length = 0;
    await cleanDatabase();
  });
  afterEach(() => { vi.unstubAllEnvs(); });
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("shows the landlord the full sequence of automated actions", async () => {
    const context = await fixture();
    const timeline = await getMaintenanceTimeline(context.landlord.id, context.organisation.id, context.request.id) as { events: Array<{ kind: string; summary: string }> };
    const kinds = timeline.events.map((event) => event.kind);
    expect(kinds[0]).toBe("reported");
    expect(kinds).toEqual(expect.arrayContaining(["routing.decision", "dispatch.attempt", "work_order", "assignment", "whatsapp.message"]));
    expect(timeline.events.find((event) => event.kind === "routing.decision")?.summary).toContain("DISPATCHED");
  });

  it("lets a person send the job elsewhere without losing history, and the old attempt never triggers a backup", async () => {
    const context = await fixture();
    await manualDispatch(context.landlord.id, context.organisation.id, context.request.id, { providerOrganisationId: context.yaw, responseTimeoutMinutes: 30 });
    const attempts = await db.maintenanceDispatchAttempt.findMany({ where: { maintenanceRequestId: context.request.id }, orderBy: { attemptNumber: "asc" } });
    expect(attempts.map((attempt) => [attempt.attemptNumber, attempt.status, attempt.providerOrganisationId])).toEqual([[1, "BACKUP_REQUIRED", context.kwame], [2, "CONTACTED", context.yaw]]);
    expect(await db.maintenanceRoutingDecision.count({ where: { maintenanceRequestId: context.request.id, outcome: "MANUAL_DISPATCH" } })).toBe(1);
    await work(new Date(Date.now() + 31 * 60_000));
    // Kwame's old timeout is a no-op; Yaw's lapses and escalates instead of looping back to Kwame.
    expect(await db.maintenanceDispatchAttempt.count({ where: { maintenanceRequestId: context.request.id } })).toBe(2);
    expect(await db.maintenanceEscalation.count({ where: { reason: "NO_PROVIDER_ACCEPTED" } })).toBe(1);
  });

  it("stops automation and resolves alerts, with audit records", async () => {
    const context = await fixture();
    expect(await stopAutomation(context.landlord.id, context.organisation.id, context.request.id, "Handling it myself")).toEqual({ closedAttempts: 1 });
    await work(new Date(Date.now() + 31 * 60_000));
    expect(await db.maintenanceDispatchAttempt.count({ where: { maintenanceRequestId: context.request.id } })).toBe(1);
    expect(await db.maintenanceEscalation.count({ where: { reason: "NO_PROVIDER_ACCEPTED" } })).toBe(0);
    await db.maintenanceEscalation.create({ data: { organisationId: context.organisation.id, maintenanceRequestId: context.request.id, level: "ATTENTION", reason: "TEST", detail: "x", dedupeKey: "t" } });
    expect(await resolveEscalations(context.landlord.id, context.organisation.id, { requestId: context.request.id })).toEqual({ resolved: 1 });
    expect(await db.auditEvent.count({ where: { action: { in: ["maintenance.automation_stopped", "maintenance.escalation_resolved"] } } })).toBe(2);
  });

  it("refuses manual dispatch to a provider who has not consented", async () => {
    const context = await fixture();
    await db.providerOrganisation.update({ where: { id: context.yaw }, data: { consentedAt: null } });
    await expect(manualDispatch(context.landlord.id, context.organisation.id, context.request.id, { providerOrganisationId: context.yaw })).rejects.toMatchObject({ code: "PROVIDER_NOT_AVAILABLE" });
  });

  it("lets NesAfric support investigate only under a support session, and review ownership claims", async () => {
    const context = await fixture();
    await expect(getMaintenanceTimelineForPlatform(context.principal, context.organisation.id, context.request.id)).rejects.toMatchObject({ code: "SUPPORT_SESSION_REQUIRED" });
    await db.platformSupportSession.create({ data: { platformPrincipalId: context.principal.id, organisationId: context.organisation.id, reason: "Investigating a failed dispatch", expiresAt: new Date(Date.now() + 3_600_000) } });
    expect(((await getMaintenanceTimelineForPlatform(context.principal, context.organisation.id, context.request.id)) as { events: unknown[] }).events.length).toBeGreaterThan(3);
    expect(await db.platformAuditEvent.count({ where: { action: "platform_admin.maintenance_timeline_viewed" } })).toBe(1);

    const claim = await db.portfolioVerification.create({ data: { organisationId: context.organisation.id, propertyId: context.property.id, claimedByUserId: context.landlord.id, claim: "OWNER", source: "WHATSAPP_ONBOARDING" } });
    expect((await listPortfolioVerificationsForPlatform(context.principal)).map((item) => item.id)).toEqual([claim.id]);
    await reviewPortfolioVerificationForPlatform(context.principal, claim.id, { status: "VERIFIED", note: "Title deed checked." });
    expect(await db.portfolioVerification.findUniqueOrThrow({ where: { id: claim.id } })).toMatchObject({ status: "VERIFIED", reviewedByPrincipalId: context.principal.id });
    await expect(reviewPortfolioVerificationForPlatform(context.principal, claim.id, { status: "REJECTED", note: "Again" })).rejects.toMatchObject({ code: "ALREADY_REVIEWED" });

    const health = await getPlatformHealth(context.principal) as { automation: Record<string, number> };
    expect(health.automation).toMatchObject({ deadLetterJobs: expect.any(Number), unconfirmedDeliveries: 0, pendingOwnershipClaims: 0 });
  });
});
