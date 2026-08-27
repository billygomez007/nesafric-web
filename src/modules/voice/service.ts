import { randomUUID } from "crypto";
import type { Prisma } from "@/platform/database/generated/client";
import { db } from "@/platform/database/client";
import { AppError, notFound, forbidden } from "@/platform/errors";
import { PERMISSIONS, requirePermission } from "@/platform/authorization/permissions";
import { assertOperational, resolveEntitlement } from "@/modules/entitlements/service";
import { ENTITLEMENTS } from "@/modules/entitlements/catalog";
import { requireMarketplaceRole } from "@/modules/marketplace-professionals/permissions";
import { assertMarketplaceOperational, resolveMarketplaceEntitlement } from "@/modules/marketplace-professionals/entitlements";
import { MARKETPLACE_ENTITLEMENTS } from "@/modules/marketplace-professionals/catalog";
import { resolveTenantIdentity } from "@/modules/conversations/identity";
import {
  createMarketplaceLead,
  createViewingRequest,
  getPublicListing,
} from "@/modules/listings/service";
import {
  checkListingAvailability,
  searchInventory,
  qualifyLead as qualifyMarketplaceLead,
  scheduleViewingForLead,
  escalateLeadToHuman,
} from "@/modules/marketplace-ai/service";
import { selectReceptionistForProperty, executeEmployeeReadTool, receptionistMaintenanceIntake, createAIEmployeeHandoff } from "@/modules/ai-employees/service";
import { proposeDispatch, recordProviderResponse } from "@/modules/maintenance-dispatch/service";
import { getAIProvider, type AIToolDefinition } from "@/modules/ai/providers";
import { voiceProviders, getActiveVoiceProviderKey, type VoiceProviderAdapter } from "./provider";
import { resolveSTTAdapter, resolveTTSAdapter, speechToTextProviders, textToSpeechProviders } from "./speech";
import { resolvePhoneNumberRouting } from "./phone-numbers";
import { issueMediaStreamToken, closeMediaStream, sweepOrphanedMediaStreams, getMediaStreamByCall } from "./media-bridge";
import { resolveConcurrentCallLimit, reserveVoiceCallSlot } from "./concurrency";
import {
  openStreamingSession,
  pushCallerTranscriptChunk,
  startAITurn,
  endAITurn,
  appendSystemTurn,
  checkSilenceTimeout,
  closeStreamingSession,
  getCallTurns,
  getStreamingSession,
} from "./realtime";
import {
  configureVoiceProviderSchema,
  startInboundCallSchema,
  voiceIdentityVerifySchema,
  outboundArtisanCallSchema,
  artisanCallResponseSchema,
  outboundProspectCallSchema,
  outboundTenantCallSchema,
  handoffRequestSchema,
  completeCallSchema,
  listVoiceCallsSchema,
  contactPreferenceSchema,
  captureVoiceLeadSchema,
  transcriptChunkSchema,
  requestTransferSchema,
  sendDigitsSchema,
} from "./schemas";

void createViewingRequest;
void getPublicListing;

// ---------------------------------------------------------------------------
// Provider configuration (items 1/15)
// ---------------------------------------------------------------------------

async function ensureProviderConfig(organisationId: string) {
  const existing = await db.voiceProviderConfig.findUnique({ where: { organisationId } });
  if (existing) return existing;
  return db.voiceProviderConfig.create({ data: { organisationId, providerKey: getActiveVoiceProviderKey() } });
}

/**
 * `organisationId` here is sometimes a Marketplace professional's hidden backing organisation
 * (item 16's "voice settings" living inside the Marketplace Pro workspace too) — a marketplace
 * member has no PropertyOS RBAC role on that organisation at all (`ensureBackingOrganisationMember`
 * grants membership with no role), so a raw `requirePermission` would reject every marketplace
 * caller outright. Mirrors `requirePropertyOsOrMarketplaceAccess` in `listings/service.ts`.
 */
export async function requireVoiceAccess(userId: string, organisationId: string, permission: string, marketplaceMinRole: "AGENT" | "ADMIN" = "AGENT") {
  const professional = await db.marketplaceProfessional.findUnique({ where: { backingOrganisationId: organisationId }, select: { id: true } });
  if (professional) return requireMarketplaceRole(userId, professional.id, marketplaceMinRole);
  return requirePermission(userId, organisationId, permission);
}

export async function getVoiceProviderConfig(userId: string, organisationId: string) {
  await requireVoiceAccess(userId, organisationId, PERMISSIONS.aiEmployeeRead);
  return ensureProviderConfig(organisationId);
}

export async function configureVoiceProvider(userId: string, organisationId: string, input: unknown) {
  await requireVoiceAccess(userId, organisationId, PERMISSIONS.aiAutonomyManage, "ADMIN");
  const data = configureVoiceProviderSchema.parse(input);
  await ensureProviderConfig(organisationId);
  const updated = await db.voiceProviderConfig.update({ where: { organisationId }, data });
  await db.auditEvent.create({ data: { organisationId, actorUserId: userId, action: "voice.provider_config.updated", entityType: "voice_provider_config", entityId: updated.id, metadata: data } });
  return updated;
}

export async function setVoiceContactPreference(userId: string, organisationId: string, input: unknown) {
  await requireVoiceAccess(userId, organisationId, PERMISSIONS.aiAutonomyManage, "ADMIN");
  const data = contactPreferenceSchema.parse(input);
  return db.voiceContactPreference.upsert({
    where: { organisationId_phoneNumber: { organisationId, phoneNumber: data.phoneNumber } },
    update: { doNotCall: data.doNotCall, reason: data.reason },
    create: { organisationId, phoneNumber: data.phoneNumber, doNotCall: data.doNotCall, reason: data.reason },
  });
}

// ---------------------------------------------------------------------------
// Voice-scoped actor resolution (item 13 — voice must respect the same autonomy policy text AI
// does; it is never granted a privileged bypass identity).
// ---------------------------------------------------------------------------

async function resolvePropertyOsVoiceActor(organisationId: string) {
  const config = await db.aIAutonomyConfiguration.findUnique({ where: { organisationId } });
  if (!config || !config.enabled || config.automationPaused) {
    throw new AppError("VOICE_AUTONOMY_NOT_CONFIGURED", 409, "AI voice cannot act until this organisation's AI autonomy configuration is enabled (Settings → AI → Autonomy).");
  }
  return config.automationActorUserId;
}

async function resolveMarketplaceVoiceActor(marketplaceProfessionalId: string) {
  const professional = await db.marketplaceProfessional.findFirst({ where: { id: marketplaceProfessionalId, archivedAt: null }, select: { createdByUserId: true } });
  if (!professional) throw notFound();
  return professional.createdByUserId;
}

async function findMarketplaceProfessionalByBackingOrg(organisationId: string) {
  return db.marketplaceProfessional.findUnique({ where: { backingOrganisationId: organisationId }, select: { id: true, backingOrganisationId: true } });
}

// ---------------------------------------------------------------------------
// Calling policy (item 15) — hours, frequency, do-not-call.
// ---------------------------------------------------------------------------

function minutesInZone(timezone: string, at: Date) {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
    const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
    const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
    return hour * 60 + minute;
  } catch {
    return at.getUTCHours() * 60 + at.getUTCMinutes();
  }
}

function isWithinBusinessHours(config: { businessHoursStart: string; businessHoursEnd: string; timezone: string }, at = new Date()) {
  const [startH, startM] = config.businessHoursStart.split(":").map(Number);
  const [endH, endM] = config.businessHoursEnd.split(":").map(Number);
  const now = minutesInZone(config.timezone, at);
  return now >= startH * 60 + startM && now <= endH * 60 + endM;
}

/**
 * Phase 22C item 10 — hard voice-minutes enforcement. Outbound calling is the organisation's own
 * choice, so unlike the inbound path (which always falls back to human handoff rather than ever
 * refusing a caller), an exhausted outbound-minutes budget is a hard block, mirroring exactly how
 * `askAI` already blocks once an organisation is over its monthly AI-token/cost budget.
 */
async function assertVoiceMinutesAvailable(organisationId: string, direction: "INBOUND" | "OUTBOUND") {
  const professional = await findMarketplaceProfessionalByBackingOrg(organisationId);
  const key = direction === "OUTBOUND" ? MARKETPLACE_ENTITLEMENTS.voiceOutboundMinutesMonthlyMax.key : MARKETPLACE_ENTITLEMENTS.voiceInboundMinutesMonthlyMax.key;
  if (professional) return assertMarketplaceOperational(professional.id, key, 0);
  const propertyOsKey = direction === "OUTBOUND" ? ENTITLEMENTS.voiceOutboundMinutesMonthlyMax.key : ENTITLEMENTS.voiceInboundMinutesMonthlyMax.key;
  return assertOperational(organisationId, propertyOsKey, 0);
}

/**
 * Item 10's inbound behaviour: a caller — possibly a tenant with an emergency — must never be
 * simply disconnected because a monthly budget ran out. `HANDOFF` (the safe default) tells the
 * caller-routing functions to fall back to the existing human-handoff-only path, exactly as if no
 * AI employee were configured. `AI_ANYWAY` is an explicit, logged grace opt-in.
 */
async function checkInboundMinutesGate(organisationId: string, config: { exhaustedMinutesBehavior: string }): Promise<{ allowed: true } | { allowed: false; reason: string }> {
  try {
    await assertVoiceMinutesAvailable(organisationId, "INBOUND");
    return { allowed: true };
  } catch (error) {
    if (config.exhaustedMinutesBehavior === "AI_ANYWAY") return { allowed: true };
    return { allowed: false, reason: error instanceof AppError ? error.message : "AI voice minutes are exhausted for this billing period." };
  }
}

/**
 * Item 12's "repeated failed outbound calls / retry ceiling": if the most recent
 * `maxConsecutiveOutboundFailures` outbound calls to this exact number all failed, further
 * attempts are blocked until an operator intervenes (a human number, a data error, or a genuinely
 * unreachable line all look the same after enough consecutive failures) rather than letting the
 * organisation burn unlimited provider cost redialling a number that will never answer.
 */
async function assertRetryCeilingNotReached(organisationId: string, toNumber: string, maxConsecutiveFailures: number) {
  if (maxConsecutiveFailures <= 0) return;
  const recent = await db.voiceCall.findMany({
    where: { organisationId, direction: "OUTBOUND", toNumber },
    orderBy: { createdAt: "desc" },
    take: maxConsecutiveFailures,
    select: { status: true },
  });
  if (recent.length === maxConsecutiveFailures && recent.every((call) => call.status === "FAILED")) {
    throw new AppError("VOICE_OUTBOUND_RETRY_CEILING_REACHED", 429, `The last ${maxConsecutiveFailures} outbound calls to this number all failed. An operator must review this number before it is called again.`);
  }
}

/** item 15's do-not-call/frequency/hours enforcement, plus item 10/12's hard minutes and
 * retry-ceiling enforcement. `bypassHours` is only ever set for an emergency-classified
 * maintenance dispatch call (item 15's "emergency exceptions"). */
async function assertOutboundAllowed(organisationId: string, toNumber: string, options: { bypassHours?: boolean } = {}) {
  const config = await ensureProviderConfig(organisationId);
  if (!config.outboundEnabled) throw new AppError("VOICE_OUTBOUND_DISABLED", 403, "Outbound voice calling is not enabled for this organisation.");
  const optOut = await db.voiceContactPreference.findUnique({ where: { organisationId_phoneNumber: { organisationId, phoneNumber: toNumber } } });
  if (optOut?.doNotCall) throw new AppError("VOICE_CONTACT_OPTED_OUT", 403, "This phone number has opted out of calls.");
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const countToday = await db.voiceCall.count({ where: { organisationId, direction: "OUTBOUND", createdAt: { gte: since } } });
  if (countToday >= config.maxOutboundCallsPerDay) throw new AppError("VOICE_OUTBOUND_FREQUENCY_LIMIT", 429, "The outbound calling frequency limit has been reached for this organisation today.");
  if (!options.bypassHours && !isWithinBusinessHours(config)) throw new AppError("VOICE_OUTSIDE_CALLING_HOURS", 409, "Outbound calls are restricted to this organisation's configured calling hours.");
  await assertRetryCeilingNotReached(organisationId, toNumber, config.maxConsecutiveOutboundFailures);
  await assertVoiceMinutesAvailable(organisationId, "OUTBOUND");
  return config;
}

/**
 * Phase 22C item 1 — attaches a real-time media stream to a just-answered call, best-effort: never
 * throws, never blocks call routing. Skipped entirely (fails safe, per item 4) for a real
 * (non-mock) provider with no deployed media-bridge URL configured — instructing a real telephony
 * provider to stream audio nowhere would be worse than not offering live audio at all.
 */
async function attachMediaStream(callId: string, organisationId: string, providerKey: string, providerCallId: string) {
  try {
    const config = await ensureProviderConfig(organisationId);
    const adapter = voiceProviders.get(providerKey);
    if (adapter.key !== "MOCK" && !config.mediaStreamWsUrl) return null;
    const session = await issueMediaStreamToken(callId);
    const wsUrl = config.mediaStreamWsUrl ?? `wss://mock-media-bridge.test.invalid/${session.id}`;
    const result = await adapter.startMediaStream(providerCallId, wsUrl, session.streamToken);
    if (result.status !== "OK") {
      await closeMediaStream(session.streamToken, `start_failed: ${result.failureReason ?? "unknown"}`).catch(() => undefined);
      return null;
    }
    return session;
  } catch {
    // Best-effort: a media-bridge failure never prevents the underlying call from proceeding —
    // the call simply continues without live audio (item 4's "fail safely").
    return null;
  }
}

// ---------------------------------------------------------------------------
// Call record helpers
// ---------------------------------------------------------------------------

async function appendTranscript(callId: string, speaker: string, line: string) {
  const call = await db.voiceCall.findUniqueOrThrow({ where: { id: callId }, select: { transcriptText: true } });
  const entry = `[${new Date().toISOString()}] ${speaker}: ${line}`;
  return db.voiceCall.update({ where: { id: callId }, data: { transcriptText: call.transcriptText ? `${call.transcriptText}\n${entry}` : entry } });
}

async function loadCall(callId: string) {
  const call = await db.voiceCall.findUnique({ where: { id: callId }, include: { conversation: true } });
  if (!call) throw notFound();
  return call;
}

// ---------------------------------------------------------------------------
// Inbound call routing (items 3/4/5/11)
// ---------------------------------------------------------------------------

/**
 * Simulates the moment a telephony provider connects an inbound call to NesAfric (item 1's
 * "inbound calls"). Resolves the receiving organisation/professional strictly from the dialled
 * number (`VoiceProviderConfig.phoneNumber`) — never trusts caller-supplied routing hints for
 * *which* organisation answers, only for context once routing is settled (item 13: voice input is
 * untrusted). Idempotent on `[providerKey, providerCallId]` (item 20's "call idempotency"). Item
 * 11's "prevent two AI employees from answering the same call" is satisfied by construction, not
 * a runtime guard: `VoiceCall.aiEmployeeId` is assigned exactly once, right here, and every other
 * function in this module reads the employee *from the call* — none of them ever accept an
 * employee id from the caller — so there is no code path through which a second employee could
 * attach to an already-routed call.
 */
export async function startInboundCall(input: unknown) {
  const data = startInboundCallSchema.parse(input);
  if (data.providerCallId) {
    const existing = await db.voiceCall.findUnique({ where: { providerKey_providerCallId: { providerKey: data.providerKey, providerCallId: data.providerCallId } } });
    if (existing) return { call: existing, conversation: null, routing: null, idempotentReplay: true };
  }
  const providerCallId = data.providerCallId ?? `mock_inbound_${randomUUID()}`;

  // Phase 22B item 9: the granular `PhoneNumber` table is checked first; an organisation that has
  // never configured one keeps routing exactly as it did in Phase 22 via the legacy single-number
  // `VoiceProviderConfig.phoneNumber` fallback below.
  const phoneNumberRouting = await resolvePhoneNumberRouting(data.providerKey, data.toNumber);
  const routing = phoneNumberRouting
    ?? await db.voiceProviderConfig.findFirst({ where: { phoneNumber: data.toNumber }, select: { organisationId: true, inboundEnabled: true } });
  if (!routing) {
    throw new AppError("VOICE_NUMBER_NOT_ROUTABLE", 404, "No NesAfric organisation or marketplace profile is configured for this number.");
  }
  const organisationId = routing.organisationId;
  const professional = await findMarketplaceProfessionalByBackingOrg(organisationId);

  if (professional) return startInboundMarketplaceCall(organisationId, professional.id, data, providerCallId, routing.inboundEnabled);
  return startInboundPropertyOsCall(organisationId, data, providerCallId, routing.inboundEnabled);
}

async function createHandoffOnlyCall(organisationId: string, data: { fromNumber: string; toNumber: string; providerKey: string }, providerCallId: string, reason: string) {
  const conversation = await db.conversation.create({
    data: { organisationId, channel: "VOICE", status: "HUMAN_REQUIRED", channelAddress: data.fromNumber, aiSummary: reason },
  });
  const call = await db.voiceCall.create({
    data: {
      organisationId, conversationId: conversation.id, direction: "INBOUND", status: "IN_PROGRESS",
      fromNumber: data.fromNumber, toNumber: data.toNumber, providerKey: data.providerKey, providerCallId,
      outcome: "HANDED_OFF_TO_HUMAN", failureReason: reason,
    },
  });
  return { call, conversation, routing: { requiresHandoff: true, reason }, idempotentReplay: false };
}

async function startInboundMarketplaceCall(
  organisationId: string,
  marketplaceProfessionalId: string,
  data: { fromNumber: string; toNumber: string; providerKey: string; listingId?: string },
  providerCallId: string,
  inboundEnabled: boolean,
) {
  if (!inboundEnabled) return createHandoffOnlyCall(organisationId, data, providerCallId, "Inbound voice is not enabled for this line.");
  const marketplaceEntitlement = await resolveMarketplaceEntitlement(marketplaceProfessionalId, MARKETPLACE_ENTITLEMENTS.aiReceptionistVoiceEnabled.key);
  if (!marketplaceEntitlement.booleanValue) return createHandoffOnlyCall(organisationId, data, providerCallId, "AI Sales Receptionist voice is not enabled on this marketplace plan.");

  const employee = await db.aIEmployee.findFirst({
    where: { marketplaceProfessionalId, role: "AI_SALES_RECEPTIONIST", status: "ACTIVE", archivedAt: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (!employee) return createHandoffOnlyCall(organisationId, data, providerCallId, "No active AI Sales Receptionist is configured.");

  const config = await ensureProviderConfig(organisationId);
  const minutesGate = await checkInboundMinutesGate(organisationId, config);
  if (!minutesGate.allowed) return createHandoffOnlyCall(organisationId, data, providerCallId, minutesGate.reason);

  const conversation = await db.conversation.create({
    data: {
      organisationId, channel: "VOICE", status: "AI_ACTIVE", channelAddress: data.fromNumber,
      listingId: data.listingId, assignedAIEmployeeId: employee.id,
    },
  });
  const concurrencyLimit = await resolveConcurrentCallLimit(organisationId, marketplaceProfessionalId);
  let call;
  try {
    call = await reserveVoiceCallSlot(
      organisationId,
      { organisationLimit: concurrencyLimit, direction: "INBOUND", aiEmployeeId: employee.id, maxPerEmployee: config.maxConcurrentCallsPerEmployee },
      (tx) => tx.voiceCall.create({
        data: {
          organisationId, conversationId: conversation.id, aiEmployeeId: employee.id, direction: "INBOUND", status: "IN_PROGRESS",
          fromNumber: data.fromNumber, toNumber: data.toNumber, providerKey: data.providerKey, providerCallId,
          answeredAt: new Date(),
        },
      }),
    );
  } catch (error) {
    if (error instanceof AppError) {
      await db.conversation.update({ where: { id: conversation.id }, data: { status: "CLOSED" } }).catch(() => undefined);
      return createHandoffOnlyCall(organisationId, data, providerCallId, error.message);
    }
    throw error;
  }
  await appendTranscript(call.id, "SYSTEM", `Call routed to AI Sales Receptionist "${employee.name}".`);
  await attachMediaStream(call.id, organisationId, data.providerKey, providerCallId);
  return { call, conversation, routing: { scope: "MARKETPLACE" as const, marketplaceProfessionalId, employeeId: employee.id, requiresHandoff: false }, idempotentReplay: false };
}

async function startInboundPropertyOsCall(
  organisationId: string,
  data: { fromNumber: string; toNumber: string; providerKey: string; listingId?: string },
  providerCallId: string,
  inboundEnabled: boolean,
) {
  if (!inboundEnabled) return createHandoffOnlyCall(organisationId, data, providerCallId, "Inbound voice is not enabled for this line.");
  const entitlement = await resolveEntitlement(organisationId, ENTITLEMENTS.aiReceptionistVoiceEnabled.key);
  if (!entitlement.booleanValue) return createHandoffOnlyCall(organisationId, data, providerCallId, "AI Receptionist voice is not enabled on this plan.");

  let propertyId: string | undefined;
  if (data.listingId) {
    const listing = await db.listing.findFirst({ where: { id: data.listingId, organisationId }, select: { propertyId: true } });
    propertyId = listing?.propertyId ?? undefined;
  }
  const employee = await selectReceptionistForProperty(organisationId, propertyId);
  if (!employee) return createHandoffOnlyCall(organisationId, data, providerCallId, "No active AI Receptionist is configured for this property.");

  const config = await ensureProviderConfig(organisationId);
  const minutesGate = await checkInboundMinutesGate(organisationId, config);
  if (!minutesGate.allowed) return createHandoffOnlyCall(organisationId, data, providerCallId, minutesGate.reason);

  const identity = await resolveTenantIdentity(organisationId, { phone: data.fromNumber });
  const conversation = await db.conversation.create({
    data: {
      organisationId, channel: "VOICE", status: "AI_ACTIVE", channelAddress: data.fromNumber,
      listingId: data.listingId, propertyId, assignedAIEmployeeId: employee.id,
      identityLevel: identity.level, tenantOrganisationId: identity.tenantOrganisationId,
    },
  });
  const concurrencyLimit = await resolveConcurrentCallLimit(organisationId, null);
  let call;
  try {
    call = await reserveVoiceCallSlot(
      organisationId,
      { organisationLimit: concurrencyLimit, direction: "INBOUND", aiEmployeeId: employee.id, maxPerEmployee: config.maxConcurrentCallsPerEmployee },
      (tx) => tx.voiceCall.create({
        data: {
          organisationId, conversationId: conversation.id, aiEmployeeId: employee.id, direction: "INBOUND", status: "IN_PROGRESS",
          fromNumber: data.fromNumber, toNumber: data.toNumber, providerKey: data.providerKey, providerCallId,
          answeredAt: new Date(), callerIdentityLevel: identity.level,
        },
      }),
    );
  } catch (error) {
    if (error instanceof AppError) {
      await db.conversation.update({ where: { id: conversation.id }, data: { status: "CLOSED" } }).catch(() => undefined);
      return createHandoffOnlyCall(organisationId, data, providerCallId, error.message);
    }
    throw error;
  }
  await appendTranscript(call.id, "SYSTEM", `Call routed to AI Receptionist "${employee.name}".${identity.level !== "NONE" ? ` Caller phone matched a tenant record (${identity.level}).` : ""}`);
  await attachMediaStream(call.id, organisationId, data.providerKey, providerCallId);
  return { call, conversation, routing: { scope: "PROPERTYOS" as const, employeeId: employee.id, requiresHandoff: false, identityLevel: identity.level }, idempotentReplay: false };
}

// ---------------------------------------------------------------------------
// Caller identity verification (item 5) — a voice-specific second factor beyond the phone-number
// match `resolveTenantIdentity` already performs for text channels. Phone match alone (CLAIMED)
// is never enough to reach VERIFIED over voice, where the caller ID itself can be spoofed.
// ---------------------------------------------------------------------------

export async function verifyVoiceCallerIdentity(callId: string, input: unknown) {
  const data = voiceIdentityVerifySchema.parse(input);
  const call = await loadCall(callId);
  const claimed = await resolveTenantIdentity(call.organisationId, { phone: data.phone });
  if (claimed.level !== "CLAIMED" || !claimed.tenantOrganisationId) {
    await appendTranscript(callId, "SYSTEM", "Identity verification failed: no tenant record matches this phone number.");
    return { level: "NONE" as const };
  }
  const tenant = await db.tenantOrganisation.findUnique({ where: { id: claimed.tenantOrganisationId }, select: { email: true } });
  const verified = Boolean(tenant?.email && tenant.email.toLowerCase() === data.email.toLowerCase());
  const level = verified ? "VERIFIED" : "CLAIMED";
  await db.voiceCall.update({ where: { id: callId }, data: { callerIdentityLevel: level } });
  await db.conversation.update({ where: { id: call.conversationId }, data: { identityLevel: level, tenantOrganisationId: claimed.tenantOrganisationId } });
  await appendTranscript(callId, "SYSTEM", verified ? "Caller identity verified (phone + email match)." : "Caller phone matched a tenant record, but the email did not match — identity remains unverified for private data.");
  return { level, tenantOrganisationId: claimed.tenantOrganisationId };
}

/** Verified-tenant-only lease/payment/maintenance summary (item 5) — reuses the exact same
 * `tenants.history` read tool the text AI Receptionist already uses; an unverified caller never
 * reaches this function's data, only a 403. */
export async function getTenantCallSummary(callId: string) {
  const call = await loadCall(callId);
  if (call.callerIdentityLevel !== "VERIFIED" || !call.conversation.tenantOrganisationId) {
    throw forbidden();
  }
  if (!call.aiEmployeeId) throw new AppError("VOICE_CALL_NOT_ROUTED", 409, "This call has no assigned AI employee.");
  const actorUserId = await resolvePropertyOsVoiceActor(call.organisationId);
  const summary = await executeEmployeeReadTool(actorUserId, call.organisationId, call.aiEmployeeId, "tenants.history", { id: call.conversation.tenantOrganisationId });
  await appendTranscript(callId, "AI", "Provided verified tenant lease/payment/maintenance summary.");
  return summary;
}

// ---------------------------------------------------------------------------
// Live listing/inventory intelligence (items 3/4) — reuses the exact same deterministic functions
// the text AI Sales Receptionist/Agent already use; voice never gets its own copy of this logic.
// ---------------------------------------------------------------------------

export async function answerListingEnquiry(callId: string, input: unknown) {
  const call = await loadCall(callId);
  const professional = await findMarketplaceProfessionalByBackingOrg(call.organisationId);
  if (professional) {
    const actor = await resolveMarketplaceVoiceActor(professional.id);
    const result = await checkListingAvailability(actor, professional.id, input);
    if (result.found && !result.available) {
      const alternatives = await searchInventory(actor, professional.id, {
        purpose: result.listing?.listingType, bedrooms: result.listing?.bedrooms ?? undefined,
        city: result.listing?.location.city ?? undefined,
      }).catch(() => []);
      await appendTranscript(callId, "AI", `Listing found but not currently available. Offered ${alternatives.length} alternative(s).`);
      await db.voiceCall.update({ where: { id: callId }, data: { outcome: "INFORMATION_PROVIDED" } });
      return { ...result, alternatives };
    }
    await appendTranscript(callId, "AI", result.found ? "Answered availability enquiry from live listing data." : "No matching listing found.");
    if (result.found) await db.voiceCall.update({ where: { id: callId }, data: { outcome: "INFORMATION_PROVIDED" } });
    return result;
  }
  if (!call.aiEmployeeId) throw new AppError("VOICE_CALL_NOT_ROUTED", 409, "This call has no assigned AI employee.");
  const actorUserId = await resolvePropertyOsVoiceActor(call.organisationId);
  const result = await executeEmployeeReadTool(actorUserId, call.organisationId, call.aiEmployeeId, "listings.availability_check", input);
  await appendTranscript(callId, "AI", "Answered listing enquiry from live PropertyOS listing data.");
  await db.voiceCall.update({ where: { id: callId }, data: { outcome: "INFORMATION_PROVIDED" } });
  return result;
}

/** Conversational inventory search (item 4/11) — sale/rent, location, price, bedrooms/bathrooms,
 * amenities, development, availability. */
export async function searchCallInventory(callId: string, input: unknown) {
  const call = await loadCall(callId);
  const professional = await findMarketplaceProfessionalByBackingOrg(call.organisationId);
  if (!professional) throw new AppError("VOICE_INVENTORY_SEARCH_MARKETPLACE_ONLY", 409, "Live inventory search is available for Marketplace calls only.");
  const actor = await resolveMarketplaceVoiceActor(professional.id);
  const results = await searchInventory(actor, professional.id, input);
  await appendTranscript(callId, "AI", `Searched inventory and found ${results.length} matching unit(s).`);
  return results;
}

// ---------------------------------------------------------------------------
// Lead capture and sales flow (items 3/8)
// ---------------------------------------------------------------------------

export async function captureVoiceLead(callId: string, input: unknown) {
  const data = captureVoiceLeadSchema.parse(input);
  const call = await loadCall(callId);
  const lead = await createMarketplaceLead(data.listingId, undefined, {
    name: data.name, email: data.email, phone: data.phone ?? call.fromNumber, message: data.message, source: "VOICE_CALL",
  });
  await db.conversation.update({ where: { id: call.conversationId }, data: { marketplaceLeadId: lead.id } });
  await db.voiceCall.update({ where: { id: callId }, data: { outcome: "LEAD_CAPTURED" } });
  await appendTranscript(callId, "AI", "Captured prospect as a marketplace lead.");
  return lead;
}

/**
 * Inbound calls always route to the AI_SALES_RECEPTIONIST (item 3), but lead-qualification and
 * viewing-scheduling are AI_SALES_AGENT-scoped actions in the existing (Phase 21, unchanged)
 * marketplace-ai domain. A receptionist-answered call may still trigger these — the same phone
 * conversation naturally covers both — so this resolves the professional's own AI_SALES_AGENT
 * rather than requiring the call's own employee to already hold that role.
 */
async function findActiveMarketplaceEmployee(marketplaceProfessionalId: string, role: "AI_SALES_AGENT" | "AI_SALES_RECEPTIONIST") {
  return db.aIEmployee.findFirst({ where: { marketplaceProfessionalId, role, status: "ACTIVE", archivedAt: null }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
}

export async function qualifyVoiceLead(callId: string, input: unknown) {
  const call = await loadCall(callId);
  const professional = await findMarketplaceProfessionalByBackingOrg(call.organisationId);
  if (!professional) throw new AppError("VOICE_CALL_NOT_ROUTED", 409, "This call is not a routed marketplace sales call.");
  const salesAgent = await findActiveMarketplaceEmployee(professional.id, "AI_SALES_AGENT");
  if (!salesAgent) throw new AppError("VOICE_NO_SALES_AGENT", 409, "No active AI Sales Agent is configured to qualify this lead.");
  const actor = await resolveMarketplaceVoiceActor(professional.id);
  const lead = await qualifyMarketplaceLead(actor, professional.id, salesAgent.id, input);
  await appendTranscript(callId, "AI", "Qualified prospect requirements.");
  return lead;
}

export async function scheduleVoiceViewing(callId: string, input: unknown) {
  const call = await loadCall(callId);
  const professional = await findMarketplaceProfessionalByBackingOrg(call.organisationId);
  if (!professional) throw new AppError("VOICE_CALL_NOT_ROUTED", 409, "This call is not a routed marketplace sales call.");
  const salesAgent = await findActiveMarketplaceEmployee(professional.id, "AI_SALES_AGENT");
  if (!salesAgent) throw new AppError("VOICE_NO_SALES_AGENT", 409, "No active AI Sales Agent is configured to schedule this viewing.");
  const actor = await resolveMarketplaceVoiceActor(professional.id);
  const viewing = await scheduleViewingForLead(actor, professional.id, salesAgent.id, input);
  await db.voiceCall.update({ where: { id: callId }, data: { outcome: "VIEWING_SCHEDULED" } });
  await appendTranscript(callId, "AI", "Scheduled a viewing for the prospect.");
  return viewing;
}

// ---------------------------------------------------------------------------
// Maintenance voice intake (item 6) — reuses `receptionistMaintenanceIntake` exactly; voice adds
// only the call-context wiring.
// ---------------------------------------------------------------------------

export async function intakeMaintenanceByVoice(callId: string, input: unknown) {
  const call = await loadCall(callId);
  if (!call.aiEmployeeId) throw new AppError("VOICE_CALL_NOT_ROUTED", 409, "This call has no assigned AI employee.");
  const actorUserId = await resolvePropertyOsVoiceActor(call.organisationId);
  const result = await receptionistMaintenanceIntake(actorUserId, call.organisationId, call.aiEmployeeId, input);
  // `receptionistMaintenanceIntake` (unchanged, Phase 21 logic) returns one of three distinct
  // shapes depending on the organisation's own autonomy policy — never redesigned here, only
  // distinguished so the call record reflects what actually happened:
  if ("id" in result && "category" in result) {
    // AUTO_EXECUTE: the maintenance request was created immediately.
    await db.conversation.update({ where: { id: call.conversationId }, data: { maintenanceRequestId: result.id as string } });
    await db.voiceCall.update({ where: { id: callId }, data: { outcome: "MAINTENANCE_REQUEST_CREATED" } });
    await appendTranscript(callId, "AI", `Created a maintenance request (${(result as { category: string }).category}).`);
  } else if ("type" in result && result.type === "PROPOSAL") {
    // APPROVAL_REQUIRED: queued for an operator to approve — not a customer-facing handoff.
    await db.voiceCall.update({ where: { id: callId }, data: { outcome: "MAINTENANCE_REQUEST_CREATED" } });
    await appendTranscript(callId, "AI", "Logged the report; it is queued for operator approval before a work order is created.");
  } else {
    // The caller requested a human, or the AI was uncertain — a genuine handoff.
    await db.voiceCall.update({ where: { id: callId }, data: { outcome: "HANDED_OFF_TO_HUMAN", handoffId: "id" in result ? (result.id as string) : undefined } });
    await appendTranscript(callId, "AI", "Escalated maintenance intake to a human.");
  }
  return result;
}

// ---------------------------------------------------------------------------
// Human transfer (item 10)
// ---------------------------------------------------------------------------

export async function requestVoiceHandoff(callId: string, input: unknown) {
  const data = handoffRequestSchema.parse(input);
  const call = await loadCall(callId);
  if (!call.aiEmployeeId) throw new AppError("VOICE_CALL_NOT_ROUTED", 409, "This call has no assigned AI employee.");
  const professional = await findMarketplaceProfessionalByBackingOrg(call.organisationId);
  const contextSummary = call.transcriptText ? `${data.reason}\n\nCall transcript so far:\n${call.transcriptText}` : data.reason;
  let handoff;
  if (professional) {
    const actor = await resolveMarketplaceVoiceActor(professional.id);
    handoff = await escalateLeadToHuman(actor, professional.id, call.aiEmployeeId, {
      leadId: call.conversation.marketplaceLeadId ?? undefined, reason: data.reason, urgency: data.urgency, contextSummary,
    });
  } else {
    const actorUserId = await resolvePropertyOsVoiceActor(call.organisationId);
    handoff = await createAIEmployeeHandoff(actorUserId, call.organisationId, call.aiEmployeeId, {
      conversationId: call.conversationId, reason: data.reason, urgency: data.urgency, contextSummary,
    });
  }
  await db.voiceCall.update({ where: { id: callId }, data: { handoffId: handoff.id, outcome: "HANDED_OFF_TO_HUMAN" } });
  await db.conversation.update({ where: { id: call.conversationId }, data: { status: "HUMAN_REQUIRED" } });
  await appendTranscript(callId, "SYSTEM", `Handed off to a human: ${data.reason}`);
  return handoff;
}

// ---------------------------------------------------------------------------
// Outbound artisan calls (items 6/7/13) — orchestrates the existing dispatch-hierarchy
// (`resolveProviderHierarchy`/`proposeDispatch`/`recordProviderResponse`) exactly as-is; this
// module never re-implements provider prioritisation.
// ---------------------------------------------------------------------------

async function placeCall(adapter: VoiceProviderAdapter, toNumber: string, fromNumber: string) {
  return adapter.placeOutboundCall({ toNumber, fromNumber });
}

/**
 * The full item 6 pipeline in one call: proposes the next dispatch-hierarchy candidate (reusing
 * `proposeDispatch` exactly — private/assigned → preferred → backup → marketplace fallback,
 * item 13) and immediately places the outbound call to them. Splitting this into two existing/new
 * functions rather than one monolithic one keeps `proposeDispatch` reusable from the text/UI path
 * too, unchanged.
 */
export async function proposeAndCallArtisan(userId: string, organisationId: string, input: unknown, initiatedByAIEmployeeId?: string) {
  const attempt = await proposeDispatch(userId, organisationId, input, initiatedByAIEmployeeId);
  return placeOutboundArtisanCall(userId, organisationId, { dispatchAttemptId: attempt.id });
}

export async function placeOutboundArtisanCall(userId: string, organisationId: string, input: unknown) {
  const data = outboundArtisanCallSchema.parse(input);
  await assertOperational(organisationId, ENTITLEMENTS.maintenanceVoiceDispatchEnabled.key);
  const attempt = await db.maintenanceDispatchAttempt.findFirst({ where: { id: data.dispatchAttemptId, organisationId } });
  if (!attempt || !attempt.serviceProviderId) throw notFound();
  const provider = await db.serviceProvider.findUnique({ where: { id: attempt.serviceProviderId }, select: { contactPhone: true, displayName: true } });
  if (!provider?.contactPhone) throw new AppError("VOICE_PROVIDER_NO_PHONE", 422, "This provider has no phone number on file.");

  const request = await db.maintenanceRequest.findUnique({ where: { id: attempt.maintenanceRequestId }, select: { priority: true, propertyId: true, title: true, category: true } });
  const config = await assertOutboundAllowed(organisationId, provider.contactPhone, { bypassHours: request?.priority === "EMERGENCY" });
  if (!config.phoneNumber) throw new AppError("VOICE_PROVIDER_NOT_CONFIGURED", 422, "This organisation has no outbound caller number configured.");

  const adapter = voiceProviders.get(getActiveVoiceProviderKey());

  // Phase 22C item 10/11/12: the call row is reserved — atomically, under the org's concurrency
  // lock — BEFORE the real outbound dial is placed, not after. A real provider call is real cost
  // the instant it is placed; reserving the slot first means a concurrency-limited organisation
  // can never place more simultaneous real calls than its limit allows, and the in-flight attempt
  // itself correctly counts against that limit for the (short) window before the provider responds.
  const conversation = await db.conversation.create({
    data: {
      organisationId, channel: "VOICE", status: "AI_ACTIVE",
      channelAddress: provider.contactPhone, propertyId: request?.propertyId, maintenanceRequestId: attempt.maintenanceRequestId,
      workOrderId: attempt.workOrderId, serviceProviderId: attempt.serviceProviderId, assignedAIEmployeeId: attempt.initiatedByAIEmployeeId,
    },
  });
  const concurrencyLimit = await resolveConcurrentCallLimit(organisationId, null);
  let call;
  try {
    call = await reserveVoiceCallSlot(
      organisationId,
      { organisationLimit: concurrencyLimit, direction: "OUTBOUND", maxConcurrentOutbound: config.maxConcurrentOutboundCalls, aiEmployeeId: attempt.initiatedByAIEmployeeId, maxPerEmployee: config.maxConcurrentCallsPerEmployee },
      (tx) => tx.voiceCall.create({
        data: {
          organisationId, conversationId: conversation.id, aiEmployeeId: attempt.initiatedByAIEmployeeId, direction: "OUTBOUND",
          status: "QUEUED", fromNumber: config.phoneNumber!, toNumber: provider.contactPhone!,
          providerKey: adapter.key, providerCallId: `pending_${randomUUID()}`, dispatchAttemptId: attempt.id,
        },
      }),
    );
  } catch (error) {
    await db.conversation.update({ where: { id: conversation.id }, data: { status: "CLOSED" } }).catch(() => undefined);
    throw error;
  }

  const result = await placeCall(adapter, provider.contactPhone, config.phoneNumber);
  call = await db.voiceCall.update({
    where: { id: call.id },
    data: {
      status: result.status === "FAILED" ? "FAILED" : "IN_PROGRESS",
      providerCallId: result.providerCallId,
      answeredAt: result.status === "FAILED" ? null : new Date(),
      failureReason: result.status === "FAILED" ? result.failureReason : null,
    },
  });
  if (result.status === "FAILED") await db.conversation.update({ where: { id: conversation.id }, data: { status: "CLOSED" } }).catch(() => undefined);
  await appendTranscript(
    call.id, "SYSTEM",
    result.status === "FAILED"
      ? `Outbound call to ${provider.displayName} failed: ${result.failureReason}`
      : `Hello, this is the AI Receptionist. We have a ${request?.category ?? "maintenance"} issue (${request?.title ?? "work order"}). Are you available to attend?`,
  );
  if (result.status === "FAILED") {
    await recordProviderResponse(userId, organisationId, attempt.id, { status: "NO_RESPONSE", notes: `Call failed: ${result.failureReason}` });
  } else {
    await attachMediaStream(call.id, organisationId, adapter.key, call.providerCallId);
  }
  return call;
}

export async function recordArtisanCallResponse(userId: string, organisationId: string, callId: string, input: unknown) {
  const data = artisanCallResponseSchema.parse(input);
  const call = await db.voiceCall.findFirst({ where: { id: callId, organisationId } });
  if (!call || !call.dispatchAttemptId) throw notFound();
  const statusMap = { AVAILABLE: "ACCEPTED", UNAVAILABLE: "DECLINED", AVAILABLE_AT_TIME: "ACCEPTED", NEEDS_INFO: "CONTACTED" } as const;
  const outcomeMap = { AVAILABLE: "ARTISAN_ACCEPTED", UNAVAILABLE: "ARTISAN_DECLINED", AVAILABLE_AT_TIME: "ARTISAN_ACCEPTED", NEEDS_INFO: "NONE" } as const;
  await recordProviderResponse(userId, organisationId, call.dispatchAttemptId, { status: statusMap[data.response], notes: data.note });
  const isFinal = data.response !== "NEEDS_INFO";
  const updated = await db.voiceCall.update({
    where: { id: callId },
    data: {
      outcome: outcomeMap[data.response],
      ...(isFinal ? { status: "COMPLETED", endedAt: new Date() } : {}),
    },
  });
  await appendTranscript(callId, "PROVIDER", `Response: ${data.response}${data.scheduledAt ? ` at ${data.scheduledAt.toISOString()}` : ""}${data.note ? ` — ${data.note}` : ""}`);
  return updated;
}

// ---------------------------------------------------------------------------
// Outbound prospect calls (item 8) — consent/entitlement/policy gated; never unrestricted cold
// calling (only a lead that already exists in the pipeline may be called).
// ---------------------------------------------------------------------------

export async function placeOutboundProspectCall(userId: string, marketplaceProfessionalId: string, input: unknown) {
  await requireMarketplaceRole(userId, marketplaceProfessionalId, "AGENT");
  await assertMarketplaceOperational(marketplaceProfessionalId, MARKETPLACE_ENTITLEMENTS.aiOutboundCallsEnabled.key);
  const data = outboundProspectCallSchema.parse(input);
  const professional = await db.marketplaceProfessional.findFirst({ where: { id: marketplaceProfessionalId, archivedAt: null } });
  if (!professional) throw notFound();
  const lead = await db.marketplaceLead.findFirst({ where: { id: data.marketplaceLeadId, listing: { marketplaceProfessionalId } } });
  if (!lead || !lead.phone) throw new AppError("VOICE_LEAD_NO_PHONE", 422, "This lead has no phone number on file.");

  const config = await assertOutboundAllowed(professional.backingOrganisationId, lead.phone);
  if (!config.phoneNumber) throw new AppError("VOICE_PROVIDER_NOT_CONFIGURED", 422, "This marketplace profile has no outbound caller number configured.");
  const employee = await db.aIEmployee.findFirst({ where: { marketplaceProfessionalId, role: "AI_SALES_AGENT", status: "ACTIVE", archivedAt: null }, orderBy: [{ createdAt: "asc" }] });

  const adapter = voiceProviders.get(getActiveVoiceProviderKey());
  const organisationId = professional.backingOrganisationId;
  const conversation = await db.conversation.create({
    data: {
      organisationId, channel: "VOICE", status: "AI_ACTIVE",
      channelAddress: lead.phone, marketplaceLeadId: lead.id, assignedAIEmployeeId: employee?.id,
    },
  });
  const concurrencyLimit = await resolveConcurrentCallLimit(organisationId, marketplaceProfessionalId);
  let call;
  try {
    call = await reserveVoiceCallSlot(
      organisationId,
      { organisationLimit: concurrencyLimit, direction: "OUTBOUND", maxConcurrentOutbound: config.maxConcurrentOutboundCalls, aiEmployeeId: employee?.id, maxPerEmployee: config.maxConcurrentCallsPerEmployee },
      (tx) => tx.voiceCall.create({
        data: {
          organisationId, conversationId: conversation.id, aiEmployeeId: employee?.id, direction: "OUTBOUND",
          status: "QUEUED", fromNumber: config.phoneNumber!, toNumber: lead.phone!,
          providerKey: adapter.key, providerCallId: `pending_${randomUUID()}`, initiatedByUserId: userId,
        },
      }),
    );
  } catch (error) {
    await db.conversation.update({ where: { id: conversation.id }, data: { status: "CLOSED" } }).catch(() => undefined);
    throw error;
  }

  const result = await placeCall(adapter, lead.phone, config.phoneNumber);
  call = await db.voiceCall.update({
    where: { id: call.id },
    data: {
      status: result.status === "FAILED" ? "FAILED" : "IN_PROGRESS", providerCallId: result.providerCallId,
      answeredAt: result.status === "FAILED" ? null : new Date(), failureReason: result.status === "FAILED" ? result.failureReason : null,
    },
  });
  if (result.status === "FAILED") await db.conversation.update({ where: { id: conversation.id }, data: { status: "CLOSED" } }).catch(() => undefined);
  await appendTranscript(call.id, "SYSTEM", `Outbound ${data.purpose.toLowerCase().replaceAll("_", " ")} call.`);
  if (result.status !== "FAILED") await attachMediaStream(call.id, organisationId, adapter.key, call.providerCallId);
  return call;
}

// ---------------------------------------------------------------------------
// Outbound tenant calls (item 9) — approved operational purposes only; financial/legal/high-risk
// calls are out of scope for this phase (no lease/payment-modifying tool is ever reachable here).
// ---------------------------------------------------------------------------

export async function placeOutboundTenantCall(userId: string, organisationId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.aiAutonomyManage);
  await assertOperational(organisationId, ENTITLEMENTS.voiceOutboundEnabled.key);
  const data = outboundTenantCallSchema.parse(input);
  const tenant = await db.tenantOrganisation.findFirst({ where: { id: data.tenantOrganisationId, organisationId, archivedAt: null } });
  if (!tenant || !tenant.phone) throw new AppError("VOICE_TENANT_NO_PHONE", 422, "This tenant has no phone number on file.");

  const config = await assertOutboundAllowed(organisationId, tenant.phone);
  if (!config.phoneNumber) throw new AppError("VOICE_PROVIDER_NOT_CONFIGURED", 422, "This organisation has no outbound caller number configured.");
  const employee = await selectReceptionistForProperty(organisationId, null);

  const adapter = voiceProviders.get(getActiveVoiceProviderKey());
  const conversation = await db.conversation.create({
    data: {
      organisationId, channel: "VOICE", status: "AI_ACTIVE",
      channelAddress: tenant.phone, tenantOrganisationId: tenant.id, assignedAIEmployeeId: employee?.id, identityLevel: "VERIFIED",
    },
  });
  const concurrencyLimit = await resolveConcurrentCallLimit(organisationId, null);
  let call;
  try {
    call = await reserveVoiceCallSlot(
      organisationId,
      { organisationLimit: concurrencyLimit, direction: "OUTBOUND", maxConcurrentOutbound: config.maxConcurrentOutboundCalls, aiEmployeeId: employee?.id, maxPerEmployee: config.maxConcurrentCallsPerEmployee },
      (tx) => tx.voiceCall.create({
        data: {
          organisationId, conversationId: conversation.id, aiEmployeeId: employee?.id, direction: "OUTBOUND",
          status: "QUEUED", fromNumber: config.phoneNumber!, toNumber: tenant.phone!,
          providerKey: adapter.key, providerCallId: `pending_${randomUUID()}`, initiatedByUserId: userId, callerIdentityLevel: "VERIFIED",
        },
      }),
    );
  } catch (error) {
    await db.conversation.update({ where: { id: conversation.id }, data: { status: "CLOSED" } }).catch(() => undefined);
    throw error;
  }

  const result = await placeCall(adapter, tenant.phone, config.phoneNumber);
  call = await db.voiceCall.update({
    where: { id: call.id },
    data: {
      status: result.status === "FAILED" ? "FAILED" : "IN_PROGRESS", providerCallId: result.providerCallId,
      answeredAt: result.status === "FAILED" ? null : new Date(), failureReason: result.status === "FAILED" ? result.failureReason : null,
    },
  });
  if (result.status === "FAILED") await db.conversation.update({ where: { id: conversation.id }, data: { status: "CLOSED" } }).catch(() => undefined);
  await appendTranscript(call.id, "SYSTEM", `Outbound ${data.purpose.toLowerCase().replaceAll("_", " ")} call.`);
  if (result.status !== "FAILED") await attachMediaStream(call.id, organisationId, adapter.key, call.providerCallId);
  return call;
}

// ---------------------------------------------------------------------------
// Call completion + provider webhook ingestion (items 1/13/20)
// ---------------------------------------------------------------------------

export async function completeCall(callId: string, input: unknown) {
  const data = completeCallSchema.parse(input);
  const call = await loadCall(callId);
  const updated = await db.voiceCall.update({
    where: { id: callId },
    data: {
      status: data.status, durationSeconds: data.durationSeconds, endedAt: new Date(),
      ...(data.transcriptText ? { transcriptText: call.transcriptText ? `${call.transcriptText}\n${data.transcriptText}` : data.transcriptText } : {}),
      aiSummary: data.aiSummary, outcome: data.outcome ?? call.outcome, failureReason: data.failureReason,
    },
  });
  await db.conversation.update({
    where: { id: call.conversationId },
    data: { aiSummary: data.aiSummary, lastMessageAt: new Date(), ...(call.conversation.status === "AI_ACTIVE" ? { status: "RESOLVED", resolvedAt: new Date() } : {}) },
  });
  return updated;
}

/**
 * Ingests a provider webhook (item 1/13/20) — every event is signature-verified and deduplicated
 * on `[providerKey, externalEventId]` before it can affect any call state (replay protection).
 */
export async function ingestProviderWebhook(providerKey: string, rawBody: string, headers: Record<string, string | null>) {
  const adapter = voiceProviders.get(providerKey);
  const verification = adapter.verifyWebhookSignature(rawBody, headers);
  if (!verification.verified) throw new AppError("VOICE_WEBHOOK_SIGNATURE_INVALID", 401, "The webhook signature could not be verified.");

  // Phase 22B: normalization is provider-owned (`normalizeWebhookPayload`) rather than assuming
  // the mock transport's JSON body shape — Twilio's real webhook body is form-encoded, not JSON.
  const payload = adapter.normalizeWebhookPayload(rawBody);
  if (!payload) throw new AppError("VOICE_WEBHOOK_INVALID_PAYLOAD", 400, "The webhook body could not be parsed for this provider.");

  const call = await db.voiceCall.findUnique({ where: { providerKey_providerCallId: { providerKey, providerCallId: payload.providerCallId } } });
  if (!call) throw notFound();

  const existingEvent = await db.voiceCallEvent.findUnique({ where: { providerKey_externalEventId: { providerKey, externalEventId: payload.externalEventId } } });
  if (existingEvent) return { call, event: existingEvent, replay: true };

  const event = await db.voiceCallEvent.create({ data: { callId: call.id, providerKey, externalEventId: payload.externalEventId, type: payload.type, payload: payload as unknown as Prisma.InputJsonValue } });

  const statusUpdate: Record<string, "RINGING" | "IN_PROGRESS" | "COMPLETED" | "NO_ANSWER" | "BUSY" | "FAILED" | "CANCELED"> = {
    "call.ringing": "RINGING",
    "call.answered": "IN_PROGRESS",
    "call.no_answer": "NO_ANSWER",
    "call.busy": "BUSY",
    "call.completed": "COMPLETED",
    "call.failed": "FAILED",
    "call.canceled": "CANCELED",
  };
  const mappedStatus = statusUpdate[payload.type];
  if (mappedStatus) {
    const terminal = ["COMPLETED", "FAILED", "NO_ANSWER", "BUSY", "CANCELED"].includes(mappedStatus);
    await db.voiceCall.update({
      where: { id: call.id },
      data: {
        status: mappedStatus,
        ...(mappedStatus === "RINGING" ? { ringingAt: new Date() } : {}),
        ...(mappedStatus === "IN_PROGRESS" ? { answeredAt: new Date() } : {}),
        ...(terminal ? { endedAt: new Date(), durationSeconds: payload.durationSeconds ?? call.durationSeconds } : {}),
      },
    });
    // Item 17: a provider-reported terminal status always closes the realtime session too, even
    // if no explicit `handleCallerDisconnect` call ever arrives — never leave an orphaned session.
    if (terminal) {
      await closeStreamingSession(call.id, `provider_status_${payload.status ?? mappedStatus.toLowerCase()}`).catch(() => undefined);
      const activeMediaStream = await getMediaStreamByCall(call.id);
      if (activeMediaStream && (activeMediaStream.status === "PENDING" || activeMediaStream.status === "CONNECTED")) {
        await closeMediaStream(activeMediaStream.streamToken, `provider_status_${mappedStatus.toLowerCase()}`).catch(() => undefined);
      }
    }
    // Item 1: a real provider's own "answered" callback (not the synchronous inbound/outbound
    // placement paths, which already attach media eagerly) is the trigger to open live audio for
    // a call that started `QUEUED`/`RINGING`.
    if (mappedStatus === "IN_PROGRESS" && call.aiEmployeeId) {
      await attachMediaStream(call.id, call.organisationId, providerKey, payload.providerCallId).catch(() => undefined);
    }
  }
  return { call, event, replay: false };
}

// ---------------------------------------------------------------------------
// History, detail, analytics (items 12/16/17)
// ---------------------------------------------------------------------------

export async function listVoiceCalls(userId: string, organisationId: string, query: unknown = {}) {
  await requireVoiceAccess(userId, organisationId, PERMISSIONS.aiEmployeeRead);
  const filters = listVoiceCallsSchema.parse(query);
  const where = {
    organisationId,
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.direction ? { direction: filters.direction } : {}),
    ...(filters.aiEmployeeId ? { aiEmployeeId: filters.aiEmployeeId } : {}),
  };
  const [items, total] = await db.$transaction([
    db.voiceCall.findMany({
      where, include: { conversation: { select: { listingId: true, tenantOrganisationId: true, marketplaceLeadId: true, maintenanceRequestId: true, workOrderId: true } } },
      orderBy: [{ createdAt: "desc" }], skip: (filters.page - 1) * filters.pageSize, take: filters.pageSize,
    }),
    db.voiceCall.count({ where }),
  ]);
  return { items, total, page: filters.page, pageSize: filters.pageSize };
}

export async function getVoiceCall(userId: string, organisationId: string, callId: string) {
  await requireVoiceAccess(userId, organisationId, PERMISSIONS.aiEmployeeRead);
  const call = await db.voiceCall.findFirst({
    where: { id: callId, organisationId },
    include: {
      conversation: true,
      events: { orderBy: { occurredAt: "asc" } },
      handoff: true,
      aiEmployee: { select: { id: true, name: true, role: true } },
      turns: { orderBy: { sequence: "asc" } },
      streamingSession: true,
    },
  });
  if (!call) throw notFound();
  return call;
}

/** Real, computed metrics only (item 16) — never a fabricated/estimated figure. */
export async function getVoiceAnalytics(userId: string, organisationId: string) {
  await requireVoiceAccess(userId, organisationId, PERMISSIONS.aiEmployeeRead);
  const [inbound, outbound, answered, failed, handoffs, leadsFromCalls, viewingsFromCalls, maintenanceFromCalls, artisanContacts, durationAgg] = await Promise.all([
    db.voiceCall.count({ where: { organisationId, direction: "INBOUND" } }),
    db.voiceCall.count({ where: { organisationId, direction: "OUTBOUND" } }),
    db.voiceCall.count({ where: { organisationId, status: { in: ["IN_PROGRESS", "COMPLETED"] } } }),
    db.voiceCall.count({ where: { organisationId, status: { in: ["FAILED", "NO_ANSWER", "BUSY"] } } }),
    db.voiceCall.count({ where: { organisationId, outcome: "HANDED_OFF_TO_HUMAN" } }),
    db.voiceCall.count({ where: { organisationId, outcome: "LEAD_CAPTURED" } }),
    db.voiceCall.count({ where: { organisationId, outcome: "VIEWING_SCHEDULED" } }),
    db.voiceCall.count({ where: { organisationId, outcome: "MAINTENANCE_REQUEST_CREATED" } }),
    db.voiceCall.count({ where: { organisationId, dispatchAttemptId: { not: null } } }),
    db.voiceCall.aggregate({ where: { organisationId, durationSeconds: { not: null } }, _avg: { durationSeconds: true } }),
  ]);
  const artisanAccepted = await db.voiceCall.count({ where: { organisationId, outcome: "ARTISAN_ACCEPTED" } });
  return {
    inboundCalls: inbound, outboundCalls: outbound, answeredCalls: answered, failedCalls: failed,
    averageDurationSeconds: durationAgg._avg.durationSeconds ? Math.round(durationAgg._avg.durationSeconds) : null,
    humanHandoffs: handoffs, enquiriesConvertedToLeads: leadsFromCalls, viewingsCreated: viewingsFromCalls,
    maintenanceRequestsCreated: maintenanceFromCalls, artisanContacts,
    providerAcceptanceRate: artisanContacts > 0 ? Number((artisanAccepted / artisanContacts).toFixed(2)) : null,
  };
}

export async function listContactPreferences(userId: string, organisationId: string) {
  await requireVoiceAccess(userId, organisationId, PERMISSIONS.aiAutonomyManage, "ADMIN");
  return db.voiceContactPreference.findMany({ where: { organisationId }, orderBy: { createdAt: "desc" } });
}

// ---------------------------------------------------------------------------
// Phase 22B item 8 — human transfer / DTMF readiness, at the telephony-provider level (distinct
// from `requestVoiceHandoff`, which only ever queues a handoff/escalation record; these actually
// exercise the active provider adapter's live call-control capabilities).
// ---------------------------------------------------------------------------

async function assertVoiceCapability(organisationId: string, key: { key: string }, marketplaceKey: { key: string }) {
  const professional = await findMarketplaceProfessionalByBackingOrg(organisationId);
  if (professional) await assertMarketplaceOperational(professional.id, marketplaceKey.key, 0);
  else await assertOperational(organisationId, key.key, 0);
}

/**
 * Bridges an in-progress call live to a human number where the active provider supports it
 * (item 1's "call transfer readiness" + item 8). Always also creates the existing handoff/
 * escalation record regardless of whether the live bridge itself succeeds, so call context
 * (transcript so far, reason) is preserved exactly the same way item 10's original handoff design
 * already guarantees — a transfer is never *only* a live bridge with no audit trail if it fails.
 */
export async function transferCallToHuman(callId: string, input: unknown) {
  const data = requestTransferSchema.parse(input);
  const call = await loadCall(callId);
  await assertVoiceCapability(call.organisationId, ENTITLEMENTS.voiceHumanTransferEnabled, MARKETPLACE_ENTITLEMENTS.voiceHumanTransferEnabled);

  const adapter = voiceProviders.get(call.providerKey);
  if (!adapter.capabilities.transfer) {
    await appendTranscript(callId, "SYSTEM", `Live transfer requested to ${data.toNumber}, but the active provider does not support live call transfer.`);
    return requestVoiceHandoff(callId, { reason: `Caller requested transfer to ${data.toNumber}; the active provider cannot bridge the live call, so this requires a callback.`, urgency: "HIGH" });
  }

  const result = await adapter.transferCall(call.providerCallId, data.toNumber);
  const updated = await db.voiceCall.update({
    where: { id: callId },
    data: { transferStatus: result.status === "OK" ? "CONNECTED" : "FAILED", transferTargetNumber: data.toNumber, transferredAt: result.status === "OK" ? new Date() : null },
  });
  if (result.status === "OK") {
    // Item 9: a successfully transferred call's audio now belongs to the human line — our media
    // bridge (and AI reasoning loop) has nothing further to do with it.
    const activeMediaStream = await getMediaStreamByCall(callId);
    if (activeMediaStream && (activeMediaStream.status === "PENDING" || activeMediaStream.status === "CONNECTED")) {
      await closeMediaStream(activeMediaStream.streamToken, "transferred_to_human").catch(() => undefined);
    }
  }
  await appendTranscript(callId, "SYSTEM", result.status === "OK" ? `Call transferred live to ${data.toNumber}.` : `Live transfer to ${data.toNumber} failed: ${result.failureReason}`);
  await requestVoiceHandoff(callId, {
    reason: result.status === "OK" ? `Call transferred live to ${data.toNumber}. Preserving context for the receiving team member.` : `Live transfer to ${data.toNumber} failed (${result.failureReason}); requires a callback.`,
    urgency: result.status === "OK" ? "MEDIUM" : "HIGH",
  }).catch(() => undefined);
  return updated;
}

/** DTMF readiness (item 1). Never invoked by voice input itself — only by an operator/API caller
 * on the organisation's behalf — so a caller's spoken words can never trigger a DTMF tone (item 13's
 * "voice input is untrusted"). */
export async function sendCallDigits(callId: string, input: unknown) {
  const data = sendDigitsSchema.parse(input);
  const call = await loadCall(callId);
  const adapter = voiceProviders.get(call.providerKey);
  if (!adapter.capabilities.dtmf) throw new AppError("VOICE_DTMF_NOT_SUPPORTED", 422, "The active provider does not support sending DTMF tones.");
  const result = await adapter.sendDigits(call.providerCallId, data.digits);
  await appendTranscript(callId, "SYSTEM", result.status === "OK" ? `Sent DTMF digits: ${data.digits}` : `Failed to send DTMF digits: ${result.failureReason}`);
  return result;
}

// ---------------------------------------------------------------------------
// Phase 22B item 7 — automatic backup escalation, closing the Phase 22 technical debt. Reuses
// `proposeDispatch`/`placeOutboundArtisanCall` exactly as-is; this function only decides *when* to
// call them again. Deterministic (same latest-attempt state always yields the same decision),
// idempotent (escalating twice in a row for the same `BACKUP_REQUIRED` attempt is a no-op the
// second time, since the first call already advances the "latest attempt" past that state),
// bounded (`MAX_AUTO_ESCALATIONS_PER_WORK_ORDER`), and auditable (every step it takes already
// writes the same `AuditEvent`/`DomainEvent` rows `proposeDispatch`/`recordProviderResponse` do).
// ---------------------------------------------------------------------------

const MAX_AUTO_ESCALATIONS_PER_WORK_ORDER = 6;

export async function autoEscalateArtisanDispatch(userId: string, organisationId: string, workOrderId: string) {
  const attempts = await db.maintenanceDispatchAttempt.findMany({ where: { organisationId, workOrderId }, orderBy: { createdAt: "desc" } });
  const latest = attempts[0];
  if (!latest) throw new AppError("VOICE_NO_DISPATCH_ATTEMPT", 409, "No dispatch attempt exists for this work order yet.");
  if (latest.status !== "BACKUP_REQUIRED") {
    return { escalated: false as const, reason: "not_pending_escalation" as const, attempt: latest };
  }
  if (attempts.length >= MAX_AUTO_ESCALATIONS_PER_WORK_ORDER) {
    return { escalated: false as const, reason: "max_attempts_reached" as const, attempt: latest };
  }
  const config = await ensureProviderConfig(organisationId);
  if (latest.respondedAt) {
    const elapsedSeconds = (Date.now() - latest.respondedAt.getTime()) / 1000;
    if (elapsedSeconds < config.retryDelaySeconds) {
      return { escalated: false as const, reason: "retry_delay_not_elapsed" as const, attempt: latest };
    }
  }

  let nextAttempt;
  try {
    nextAttempt = await proposeDispatch(userId, organisationId, { workOrderId, allowMarketplaceFallback: true }, latest.initiatedByAIEmployeeId ?? undefined);
  } catch (error) {
    return { escalated: false as const, reason: "no_provider_available" as const, attempt: latest, detail: error instanceof AppError ? error.message : "Unknown error" };
  }
  const call = await placeOutboundArtisanCall(userId, organisationId, { dispatchAttemptId: nextAttempt.id });
  return { escalated: true as const, attempt: nextAttempt, call };
}

// ---------------------------------------------------------------------------
// Phase 22B item 12 — configurable, jurisdiction-driven call-opening disclosure.
// ---------------------------------------------------------------------------

async function announceOpeningDisclosure(callId: string, organisationId: string) {
  const config = await ensureProviderConfig(organisationId);
  if (config.disclosureRequired && config.openingDisclosureText) {
    await appendSystemTurn(callId, config.openingDisclosureText).catch(() => undefined);
    await appendTranscript(callId, "SYSTEM", config.openingDisclosureText);
  }
}

// ---------------------------------------------------------------------------
// Phase 22B item 3/17 — realtime streaming-session lifecycle wrappers, orchestrating
// `realtime.ts`'s pure turn-taking state machine together with the speech adapters and the
// existing voice/tool-gateway action functions above. This is the concrete implementation of the
// pipeline "caller audio → STT → transcript → existing AI employee/tool gateway → safe response →
// TTS → caller audio."
// ---------------------------------------------------------------------------

export async function beginRealtimeSession(callId: string) {
  const call = await loadCall(callId);
  const session = await openStreamingSession(callId);
  await announceOpeningDisclosure(callId, call.organisationId);
  return session;
}

const VOICE_HUMAN_REQUEST_PATTERN = /\b(human|agent|representative|real person|someone else|manager)\b/i;
// `air ?condition` deliberately has no trailing `\b` — it must still match "air conditioner" /
// "air conditioning", where "condition" is immediately followed by more letters.
const VOICE_MAINTENANCE_PATTERN = /\b(leak|broken|repair|fix|maintenance|not working|electrical|plumbing|no water|no power|ac\b)\b|\bair ?condition/i;
const VOICE_PRIVATE_DATA_PATTERN = /\b(rent|balance|owe|lease|payment|deposit|account|move[- ]?in|move[- ]?out)\b/i;
const VOICE_VIEWING_PATTERN = /\b(view|viewing|visit|see (it|the place|the property))\b/i;
const VOICE_AVAILABILITY_PATTERN = /\b(available|availability|still (there|open|available)|vacant)\b/i;
const VOICE_INVENTORY_SEARCH_PATTERN = /\b(do you have|show me|looking for|any other|what do you have|other (options|listings|units)|i need|we need|need a|looking to (rent|buy))\b/i;

/** Item 15's free-text search improvement: a small, deterministic property-type vocabulary,
 * matched against `Listing.category` (a free-text field already searched via case-insensitive
 * `contains` — see `searchInventory`/`checkListingAvailability`, never redesigned here). */
const PROPERTY_TYPE_KEYWORDS: Array<[RegExp, string]> = [
  [/\bstudio\b/i, "studio"],
  [/\btownhouse\b/i, "townhouse"],
  [/\bduplex\b/i, "duplex"],
  [/\boffice\b/i, "office"],
  [/\bland\b|\bplot\b/i, "land"],
  [/\bhouse\b/i, "house"],
  [/\bapartment\b|\bflat\b|\bunit\b/i, "apartment"],
];

function extractPropertyType(text: string): string | undefined {
  for (const [pattern, category] of PROPERTY_TYPE_KEYWORDS) {
    if (pattern.test(text)) return category;
  }
  return undefined;
}

const PRICE_UNIT_MULTIPLIERS: Record<string, number> = { million: 1_000_000, m: 1_000_000, thousand: 1_000, k: 1_000 };

/** Parses a spoken price phrase ("under GHS 2 million", "over 500 thousand cedis") into the minor
 * currency units `inventorySearchSchema`'s `minPriceMinor`/`maxPriceMinor` expect — GHS's minor
 * unit is 100 per cedi (see `prisma/seed.ts`'s plan prices), the same scale every other price
 * field in this codebase already uses. Never invents a figure the caller didn't say. */
function parsePriceBound(text: string, direction: "under" | "over"): string | undefined {
  const comparator = direction === "under" ? /\b(under|below|less than|up to|no more than|within)\b/i : /\b(over|above|at least|more than|starting (at|from))\b/i;
  const match = text.match(new RegExp(`${comparator.source}\\s*(?:ghs|cedis?)?\\s*([\\d,.]+)\\s*(million|thousand|m|k)?`, "i"));
  if (!match) return undefined;
  const amount = Number(match[2].replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  const multiplier = match[3] ? PRICE_UNIT_MULTIPLIERS[match[3].toLowerCase()] ?? 1 : 1;
  return Math.round(amount * multiplier * 100).toString();
}

const VOICE_TOOL_DEFINITIONS: AIToolDefinition[] = [
  { key: "voice.check_availability", kind: "read", description: "Check whether a specific listing is still available, from a free-text description of it (bedrooms, location, etc).", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false } },
  { key: "voice.search_inventory", kind: "read", description: "Search live inventory by structured criteria.", parameters: { type: "object", properties: { bedrooms: { type: "number" }, purpose: { type: "string", enum: ["RENT", "SALE"] }, city: { type: "string" }, category: { type: "string" }, maxPriceMinor: { type: "string" }, minPriceMinor: { type: "string" } }, additionalProperties: false } },
  { key: "voice.schedule_viewing", kind: "action", description: "The caller wants to schedule or arrange a property viewing.", parameters: { type: "object", properties: {}, additionalProperties: false } },
  { key: "voice.report_maintenance", kind: "action", description: "The caller is reporting a maintenance issue at their property.", parameters: { type: "object", properties: { description: { type: "string" } }, required: ["description"], additionalProperties: false } },
  { key: "voice.tenant_summary", kind: "read", description: "The caller is asking about their own rent, lease, payment, or maintenance status.", parameters: { type: "object", properties: {}, additionalProperties: false } },
  { key: "voice.escalate_human", kind: "action", description: "The caller explicitly asked to speak with a human.", parameters: { type: "object", properties: { reason: { type: "string" } }, additionalProperties: false } },
];
const VOICE_TOOL_KEYS = VOICE_TOOL_DEFINITIONS.map((definition) => definition.key);
const VOICE_SYSTEM_PROMPT = "You are a NesAfric AI voice receptionist. Use only the supplied tools to decide what the caller needs. Never invent property, price, availability, or account information yourself — every fact must come from a tool result. If nothing matches, ask a clarifying question instead of guessing.";

/**
 * Item 4's reasoning step, reusing the existing provider-neutral `AIProvider` abstraction
 * (`src/modules/ai/providers.ts`) instead of inventing a second reasoning system: with a real
 * OpenAI-compatible provider configured, this genuinely extracts structured arguments (bedrooms,
 * city, purpose) from the caller's own words via real tool-calling. Without one (this environment's
 * default, and every test), `DeterministicAIProvider`'s built-in keyword table never matches these
 * voice-specific tool keys, so this always falls through to `classifyVoiceIntentDeterministically`
 * — a keyword router in exactly the same style `routeInboundMessage` already uses for text
 * channels, dispatching into the *same* underlying action functions either way.
 */
async function classifyVoiceIntent(transcriptText: string): Promise<{ toolKey?: string; arguments: Record<string, unknown> }> {
  try {
    const provider = getAIProvider();
    const response = await provider.complete({ message: transcriptText, allowedTools: VOICE_TOOL_KEYS, toolDefinitions: VOICE_TOOL_DEFINITIONS, systemPrompt: VOICE_SYSTEM_PROMPT });
    if (response.toolKey) return { toolKey: response.toolKey, arguments: response.toolCall?.arguments ?? {} };
  } catch {
    // A provider failure never blocks the call (item 17) — fall through to the deterministic router.
  }
  return classifyVoiceIntentDeterministically(transcriptText);
}

const SPELLED_OUT_NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

/** Bedroom counts are spoken as often as digits ("a three-bedroom unit") — never just "3-bed". */
function extractBedroomCount(text: string): number | undefined {
  const digitMatch = text.match(/(\d+)\s*[- ]?\s*bed/i);
  if (digitMatch) return Number(digitMatch[1]);
  const wordMatch = text.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)[\s-]*bed/i);
  return wordMatch ? SPELLED_OUT_NUMBERS[wordMatch[1].toLowerCase()] : undefined;
}

function classifyVoiceIntentDeterministically(transcriptText: string): { toolKey?: string; arguments: Record<string, unknown> } {
  if (VOICE_HUMAN_REQUEST_PATTERN.test(transcriptText)) return { toolKey: "voice.escalate_human", arguments: { reason: transcriptText } };
  if (VOICE_MAINTENANCE_PATTERN.test(transcriptText)) return { toolKey: "voice.report_maintenance", arguments: { description: transcriptText } };
  if (VOICE_PRIVATE_DATA_PATTERN.test(transcriptText)) return { toolKey: "voice.tenant_summary", arguments: {} };
  if (VOICE_VIEWING_PATTERN.test(transcriptText)) return { toolKey: "voice.schedule_viewing", arguments: {} };
  if (VOICE_INVENTORY_SEARCH_PATTERN.test(transcriptText)) {
    const bedrooms = extractBedroomCount(transcriptText);
    const purposeMatch = /\bfor sale\b|\bto buy\b/i.test(transcriptText) ? "SALE" : /\bfor rent\b|\brental\b|\bto rent\b/i.test(transcriptText) ? "RENT" : undefined;
    const category = extractPropertyType(transcriptText);
    const location = extractLocationPhrase(transcriptText);
    const maxPriceMinor = parsePriceBound(transcriptText, "under");
    const minPriceMinor = parsePriceBound(transcriptText, "over");
    return {
      toolKey: "voice.search_inventory",
      arguments: {
        ...(bedrooms !== undefined ? { bedrooms } : {}),
        ...(purposeMatch ? { purpose: purposeMatch } : {}),
        ...(category ? { category } : {}),
        ...(location ? { city: location } : {}),
        ...(maxPriceMinor ? { maxPriceMinor } : {}),
        ...(minPriceMinor ? { minPriceMinor } : {}),
      },
    };
  }
  if (VOICE_AVAILABILITY_PATTERN.test(transcriptText)) {
    const bedrooms = extractBedroomCount(transcriptText);
    const purposeMatch = /\bfor sale\b/i.test(transcriptText) ? "SALE" : /\bfor rent\b|\brental\b/i.test(transcriptText) ? "RENT" : undefined;
    // `checkListingAvailability`'s free-text `query` is matched as a literal substring against a
    // listing's title/city/district/category (see `marketplace-ai/service.ts`), never a fuzzy or
    // tokenized search — passing an entire spoken sentence would essentially never match. A
    // location phrase ("in East Legon") is the part of a natural query most likely to appear
    // verbatim in a listing's `city`/`district` field, so it is extracted and used preferentially;
    // the full utterance remains the fallback for a caller who names the listing outright.
    const location = extractLocationPhrase(transcriptText);
    return { toolKey: "voice.check_availability", arguments: { query: location ?? transcriptText, ...(bedrooms !== undefined ? { bedrooms } : {}), ...(purposeMatch ? { purpose: purposeMatch } : {}) } };
  }
  return { toolKey: undefined, arguments: {} };
}

function extractLocationPhrase(text: string): string | undefined {
  const match = text.match(/\bin\s+([A-Za-z][A-Za-z\s]{1,40}?)(?=\s+(?:still|is|are|available)\b|[?.,]|$)/i);
  return match ? match[1].trim() : undefined;
}

const MAINTENANCE_CATEGORY_PATTERNS: Array<[RegExp, string]> = [
  [/\bair ?condition|\bac\b/i, "air conditioning"],
  [/\belectric|\bpower\b|\blight(s|ing)?\b|\bsocket\b|\btrip(ped|ping)?\b/i, "electrical"],
  [/\bleak|\bpipe|\bwater\b|\bplumb|\btoilet|\bdrain\b/i, "plumbing"],
  [/\broof|\bceiling\b/i, "roofing"],
  [/\bfridge|\bstove|\bcooker|\bappliance/i, "appliance"],
  [/\bdoor|\bcabinet|\bwood|\bcarpentry/i, "carpentry"],
  [/\bpaint/i, "painting"],
  [/\bcrack|\bstructur|\bfoundation|\bwall\b/i, "structural"],
  [/\block|\bsecurity|\bgate|\bbreak[- ]?in/i, "security"],
  [/\bpest|\brubbish|\btrash|\bsanitat/i, "sanitation"],
];

/** Item 6's "interpret AC/electrical/plumbing" requirement — deterministic keyword classification
 * against `receptionistIntakeSchema`'s strict category enum, never a free-text guess passed
 * straight through (which that schema would reject anyway). */
function classifyMaintenanceCategory(text: string): string {
  for (const [pattern, category] of MAINTENANCE_CATEGORY_PATTERNS) {
    if (pattern.test(text)) return category;
  }
  return "other";
}

export type VoiceTranscriptRouteResult = { kind: string; responseText: string; data?: unknown };

/**
 * Item 4/5/6's real-time dispatch layer: takes one *final* caller utterance and drives it to the
 * correct already-built Phase 22 action function. Never fabricates a response itself — every
 * branch either calls a function that reads real data, or asks a clarifying question.
 */
export async function routeVoiceTranscript(callId: string, transcriptText: string): Promise<VoiceTranscriptRouteResult> {
  const classification = await classifyVoiceIntent(transcriptText);
  const call = await loadCall(callId);

  switch (classification.toolKey) {
    case "voice.escalate_human": {
      const reason = typeof classification.arguments.reason === "string" ? classification.arguments.reason : "Caller requested a human.";
      await requestVoiceHandoff(callId, { reason, urgency: "MEDIUM" });
      return { kind: "HANDOFF", responseText: "Connecting you with a team member now." };
    }
    case "voice.check_availability": {
      const query = typeof classification.arguments.query === "string" ? classification.arguments.query : transcriptText;
      const result = await answerListingEnquiry(callId, { query });
      return { kind: "AVAILABILITY", responseText: describeAvailability(result), data: result };
    }
    case "voice.search_inventory": {
      const professional = await findMarketplaceProfessionalByBackingOrg(call.organisationId);
      if (!professional) return { kind: "UNSUPPORTED", responseText: "I can look up specific listings by description — could you tell me more about what you're looking for?" };
      const results = await searchCallInventory(callId, {
        ...(typeof classification.arguments.bedrooms === "number" ? { bedrooms: classification.arguments.bedrooms } : {}),
        ...(classification.arguments.purpose === "RENT" || classification.arguments.purpose === "SALE" ? { purpose: classification.arguments.purpose } : {}),
        ...(typeof classification.arguments.city === "string" ? { city: classification.arguments.city } : {}),
        ...(typeof classification.arguments.category === "string" ? { category: classification.arguments.category } : {}),
        ...(typeof classification.arguments.maxPriceMinor === "string" ? { maxPriceMinor: classification.arguments.maxPriceMinor } : {}),
        ...(typeof classification.arguments.minPriceMinor === "string" ? { minPriceMinor: classification.arguments.minPriceMinor } : {}),
      });
      return { kind: "INVENTORY", responseText: describeInventory(results), data: results };
    }
    case "voice.report_maintenance": {
      const propertyId = call.conversation.propertyId;
      if (!propertyId) {
        await requestVoiceHandoff(callId, { reason: "Maintenance reported, but no property is linked to this call.", urgency: "MEDIUM" });
        return { kind: "HANDOFF", responseText: "Let me connect you with a team member to log that for the right property." };
      }
      const description = typeof classification.arguments.description === "string" ? classification.arguments.description : transcriptText;
      const result = await intakeMaintenanceByVoice(callId, {
        propertyId, title: description.slice(0, 120), description, category: classifyMaintenanceCategory(description),
        idempotencyKey: `voice-turn-${callId}`,
      });
      return { kind: "MAINTENANCE", responseText: "I've logged that report and it's being handled.", data: result };
    }
    case "voice.tenant_summary": {
      try {
        const summary = await getTenantCallSummary(callId);
        return { kind: "TENANT_SUMMARY", responseText: "Here is your current account summary.", data: summary };
      } catch {
        return { kind: "IDENTITY_REQUIRED", responseText: "I can share account details once I verify your identity — could I get the email address on your account?" };
      }
    }
    case "voice.schedule_viewing":
      return { kind: "NEEDS_INFO", responseText: "I can help schedule a viewing — could I get your name and a good phone number first?" };
    default:
      return { kind: "UNRECOGNIZED", responseText: "I'm here to help — could you tell me a bit more about what you're looking for?" };
  }
}

function describeAvailability(result: Awaited<ReturnType<typeof answerListingEnquiry>>): string {
  if (!("found" in result) || !result.found) return "I couldn't find a listing matching that description.";
  if (!result.available) return "That listing exists, but it's not currently available. I can suggest some alternatives.";
  return "Yes, that listing is currently available.";
}

function describeInventory(results: unknown[]): string {
  if (results.length === 0) return "I couldn't find any matching listings right now.";
  return `I found ${results.length} matching listing${results.length === 1 ? "" : "s"}.`;
}

/**
 * The full item 2/3 pipeline for one chunk of caller audio: STT → transcript → (if final) route to
 * the tool gateway → TTS. `simulatedText`/`audioChunkBase64` — see `speech.ts`'s module doc comment
 * for why this environment's STT adapters operate on text rather than real audio bytes.
 */
async function recordVoiceRuntimeFailure(organisationId: string, callId: string, action: "voice.stt_failed" | "voice.tts_failed", error: unknown) {
  // Item 13: observable, but never logs raw audio or transcript content — only the failure event
  // itself and a safe error message.
  await db.auditEvent.create({ data: { organisationId, action, entityType: "voice_call", entityId: callId, metadata: { message: error instanceof Error ? error.message : "Unknown error" } } }).catch(() => undefined);
}

export async function submitCallerAudioChunk(callId: string, input: unknown) {
  const data = transcriptChunkSchema.parse(input);
  const call = await loadCall(callId);
  const config = await ensureProviderConfig(call.organisationId);
  const persona = call.aiEmployeeId ? await db.voicePersonaConfig.findUnique({ where: { aiEmployeeId: call.aiEmployeeId } }) : null;
  const language = persona?.language ?? "en";

  const sttAdapter = resolveSTTAdapter(config.sttProviderKey);
  let transcribed;
  try {
    transcribed = await sttAdapter.transcribe({ audioChunkBase64: data.audioChunkBase64, simulatedText: data.simulatedText, language, isFinalChunk: data.isFinalChunk });
  } catch (error) {
    // Item 4/13: fail safely — never pretend live AI voice is operational when speech recognition
    // itself is down. Escalates to a human rather than leaving the caller in dead air.
    await recordVoiceRuntimeFailure(call.organisationId, callId, "voice.stt_failed", error);
    await requestVoiceHandoff(callId, { reason: "Speech recognition is temporarily unavailable.", urgency: "MEDIUM" }).catch(() => undefined);
    return { status: "HANDED_OFF" as const, bargeIn: false, reason: "stt_unavailable" as const };
  }
  const estimatedSttSeconds = transcribed.text ? Math.max(0.5, transcribed.text.trim().split(/\s+/).length / 2.5) : 0;
  if (estimatedSttSeconds > 0) await db.voiceCall.update({ where: { id: callId }, data: { sttSecondsUsed: { increment: estimatedSttSeconds } } }).catch(() => undefined);

  const pushResult = await pushCallerTranscriptChunk(callId, { textDelta: transcribed.text, isFinal: transcribed.isFinal });
  if (!pushResult.finalTranscript) {
    return { status: "LISTENING" as const, bargeIn: pushResult.bargeIn };
  }

  const routed = await routeVoiceTranscript(callId, pushResult.finalTranscript);
  await appendTranscript(callId, "CALLER", pushResult.finalTranscript);

  const ttsAdapter = resolveTTSAdapter(config.ttsProviderKey);
  let synthesis;
  try {
    synthesis = await ttsAdapter.synthesize({ text: routed.responseText, language, voiceProfileId: persona?.voiceProfileId ?? undefined });
  } catch (error) {
    await recordVoiceRuntimeFailure(call.organisationId, callId, "voice.tts_failed", error);
    await requestVoiceHandoff(callId, { reason: "Speech synthesis is temporarily unavailable.", urgency: "MEDIUM" }).catch(() => undefined);
    return { status: "HANDED_OFF" as const, bargeIn: pushResult.bargeIn, kind: routed.kind, reason: "tts_unavailable" as const };
  }
  await startAITurn(callId, routed.responseText);
  await appendTranscript(callId, "AI", routed.responseText);
  await db.voiceCall.update({ where: { id: callId }, data: { ttsCharactersUsed: { increment: synthesis.characterCount } } });

  return { status: "AI_SPEAKING" as const, bargeIn: pushResult.bargeIn, kind: routed.kind, responseText: routed.responseText, audioRef: synthesis.audioRef };
}

/** Signalled once TTS playback of the current AI turn has actually finished (item 3) — returns the
 * conversation to `LISTENING` so the caller can speak again (including barging in before this is
 * even called, which `pushCallerTranscriptChunk` already handles independently). */
export async function finishAISpeaking(callId: string) {
  return endAITurn(callId);
}

/**
 * Item 3's silence-detection polling entrypoint — a real audio bridge calls this on a timer while
 * the caller is quiet; a test calls it directly with an injected clock via `realtime.ts`. Phase
 * 22C item 12 folds the cost-protection "maximum call duration" ceiling into the same periodic
 * check: a call still technically `IN_PROGRESS` well past `maxCallDurationSeconds` is terminated
 * outright — a stuck or forgotten call can never run (and accrue provider/AI cost) forever.
 */
export async function checkCallSilence(callId: string, now = new Date()) {
  const call = await loadCall(callId);
  if (call.status === "IN_PROGRESS" && call.answeredAt) {
    const config = await ensureProviderConfig(call.organisationId);
    const elapsedSeconds = (now.getTime() - call.answeredAt.getTime()) / 1000;
    if (elapsedSeconds > config.maxCallDurationSeconds) {
      const adapter = voiceProviders.get(call.providerKey);
      await adapter.terminateCall(call.providerCallId, "max_call_duration_exceeded").catch(() => undefined);
      await handleCallerDisconnect(callId, "max_call_duration_exceeded");
      return { timedOut: true as const, action: "MAX_DURATION_EXCEEDED" as const };
    }
  }
  const result = await checkSilenceTimeout(callId, now);
  if (result.timedOut && result.action === "PROMPT") {
    await appendSystemTurn(callId, "Are you still there?").catch(() => undefined);
    await appendTranscript(callId, "SYSTEM", "Silence detected — prompted the caller.");
  }
  if (result.timedOut && result.action === "DISCONNECT") {
    await handleCallerDisconnect(callId, "silence_timeout");
  }
  return result;
}

/** Item 3/17's caller-disconnect / abandoned-call handling. Idempotent — closing an already-closed
 * session and completing an already-terminal call are both safe no-ops. Also closes any active
 * media stream for this call (item 1/12) — audio has nowhere useful to go once the call itself is
 * ending. */
export async function handleCallerDisconnect(callId: string, reason = "caller_disconnected") {
  await closeStreamingSession(callId, reason);
  const activeMediaStream = await getMediaStreamByCall(callId);
  if (activeMediaStream && (activeMediaStream.status === "PENDING" || activeMediaStream.status === "CONNECTED")) {
    await closeMediaStream(activeMediaStream.streamToken, reason).catch(() => undefined);
  }
  const call = await loadCall(callId);
  if (!["COMPLETED", "FAILED", "NO_ANSWER", "BUSY", "CANCELED"].includes(call.status)) {
    await completeCall(callId, { status: "COMPLETED", failureReason: reason === "caller_disconnected" ? undefined : reason }).catch(() => undefined);
  }
  return { closed: true };
}

export async function getCallTranscriptTurns(callId: string) {
  return getCallTurns(callId);
}

export async function getCallRealtimeSession(callId: string) {
  return getStreamingSession(callId);
}

// ---------------------------------------------------------------------------
// Phase 22C item 13/14 — real-time observability and health status. Every figure here is a live
// computed query, never a fabricated or estimated one.
// ---------------------------------------------------------------------------

export async function getVoiceOperationalSnapshot(userId: string, organisationId: string) {
  await requireVoiceAccess(userId, organisationId, PERMISSIONS.aiEmployeeRead);
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const [activeCalls, activeMediaStreams, sttFailures, ttsFailures, handoffs, droppedCalls, durationAgg] = await Promise.all([
    db.voiceCall.count({ where: { organisationId, status: { in: ["QUEUED", "RINGING", "IN_PROGRESS"] } } }),
    db.mediaStreamSession.count({ where: { organisationId, status: { in: ["PENDING", "CONNECTED"] } } }),
    db.auditEvent.count({ where: { organisationId, action: "voice.stt_failed", createdAt: { gte: since } } }),
    db.auditEvent.count({ where: { organisationId, action: "voice.tts_failed", createdAt: { gte: since } } }),
    db.voiceCall.count({ where: { organisationId, outcome: "HANDED_OFF_TO_HUMAN", createdAt: { gte: since } } }),
    db.voiceCall.count({ where: { organisationId, status: { in: ["FAILED", "NO_ANSWER", "BUSY"] }, createdAt: { gte: since } } }),
    db.voiceCall.aggregate({ where: { organisationId, durationSeconds: { not: null }, createdAt: { gte: since } }, _avg: { durationSeconds: true } }),
  ]);
  return {
    windowMinutes: 60, activeCalls, activeMediaStreams, sttFailures, ttsFailures, handoffs, droppedCalls,
    averageDurationSeconds: durationAgg._avg.durationSeconds ? Math.round(durationAgg._avg.durationSeconds) : null,
  };
}

export type VoiceHealthStatus = "MOCK_TEST" | "CONFIGURED" | "PARTIALLY_CONFIGURED" | "READY" | "DEGRADED" | "UNAVAILABLE";

/**
 * Item 14 — never reports `READY` merely because telephony credentials exist. `READY` requires a
 * real telephony provider AND a real STT provider AND a real TTS provider AND a deployed media
 * bridge URL, all simultaneously and all actually verified via each adapter's own
 * `isConfigured()` — never inferred from one signal alone.
 */
export async function getVoiceHealthStatus(userId: string, organisationId: string) {
  await requireVoiceAccess(userId, organisationId, PERMISSIONS.aiEmployeeRead);
  const config = await ensureProviderConfig(organisationId);
  if (config.status !== "ACTIVE") return { status: "UNAVAILABLE" as const, telephonyReal: false, sttReal: false, ttsReal: false, bridgeConfigured: false };

  const telephonyAdapter = voiceProviders.get(config.providerKey);
  const telephonyReal = telephonyAdapter.key !== "MOCK" && telephonyAdapter.isConfigured();
  const sttAdapter = speechToTextProviders.get(config.sttProviderKey);
  const sttReal = sttAdapter.key !== "MOCK" && sttAdapter.isConfigured();
  const ttsAdapter = textToSpeechProviders.get(config.ttsProviderKey);
  const ttsReal = ttsAdapter.key !== "MOCK" && ttsAdapter.isConfigured();
  const bridgeConfigured = Boolean(config.mediaStreamWsUrl);

  if (!telephonyReal) return { status: "MOCK_TEST" as const, telephonyReal, sttReal, ttsReal, bridgeConfigured };

  const allReal = sttReal && ttsReal && bridgeConfigured;
  const noneReal = !sttReal && !ttsReal && !bridgeConfigured;
  if (allReal) {
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const recentFailures = await db.auditEvent.count({ where: { organisationId, action: { in: ["voice.stt_failed", "voice.tts_failed"] }, createdAt: { gte: since } } });
    if (recentFailures >= 5) return { status: "DEGRADED" as const, telephonyReal, sttReal, ttsReal, bridgeConfigured, recentFailures };
    return { status: "READY" as const, telephonyReal, sttReal, ttsReal, bridgeConfigured };
  }
  if (noneReal) return { status: "CONFIGURED" as const, telephonyReal, sttReal, ttsReal, bridgeConfigured };
  return { status: "PARTIALLY_CONFIGURED" as const, telephonyReal, sttReal, ttsReal, bridgeConfigured };
}

/** Item 12/17 — periodic maintenance sweep, safe to call repeatedly (e.g. from a cron). Closes
 * orphaned media streams and terminates any call that has exceeded its configured maximum
 * duration, across the whole organisation. */
export async function sweepVoiceRuntime(organisationId: string, now = new Date()) {
  const streamSweep = await sweepOrphanedMediaStreams(now);
  const overrunning = await db.voiceCall.findMany({
    where: { organisationId, status: "IN_PROGRESS", answeredAt: { not: null } },
    select: { id: true },
  });
  let durationTerminated = 0;
  for (const { id } of overrunning) {
    const result = await checkCallSilence(id, now);
    if (result.timedOut && "action" in result && result.action === "MAX_DURATION_EXCEEDED") durationTerminated += 1;
  }
  return { ...streamSweep, durationTerminated };
}
