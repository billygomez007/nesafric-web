import { z } from "zod";

const text = (max: number) => z.string().trim().min(1).max(max);
const id = z.string().uuid();
const phone = z.string().trim().min(6).max(20);

export const configureVoiceProviderSchema = z.object({
  phoneNumber: phone.optional(),
  inboundEnabled: z.boolean().optional(),
  outboundEnabled: z.boolean().optional(),
  timezone: text(60).optional(),
  businessHoursStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  businessHoursEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  maxRetryAttempts: z.coerce.number().int().min(0).max(10).optional(),
  retryDelaySeconds: z.coerce.number().int().min(30).max(86_400).optional(),
  maxOutboundCallsPerDay: z.coerce.number().int().min(0).max(10_000).optional(),
  recordingEnabled: z.boolean().optional(),
  consentRequired: z.boolean().optional(),
  sttProviderKey: text(40).optional(),
  ttsProviderKey: text(40).optional(),
  countryCode: z.string().trim().length(2).optional(),
  openingDisclosureText: text(2000).optional(),
  recordingDisclosureText: text(2000).optional(),
  disclosureRequired: z.boolean().optional(),
  /// Phase 22C item 1/10/11/12 — media bridge + runtime enforcement configuration.
  mediaStreamWsUrl: z.string().trim().url().optional(),
  maxCallDurationSeconds: z.coerce.number().int().min(30).max(14_400).optional(),
  maxConsecutiveOutboundFailures: z.coerce.number().int().min(0).max(50).optional(),
  maxConcurrentCallsPerEmployee: z.coerce.number().int().min(1).max(1_000).optional(),
  maxConcurrentOutboundCalls: z.coerce.number().int().min(1).max(1_000).optional(),
  exhaustedMinutesBehavior: z.enum(["HANDOFF", "AI_ANYWAY"]).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required.");

export const startInboundCallSchema = z.object({
  toNumber: phone,
  fromNumber: phone,
  providerKey: text(40).default("MOCK"),
  providerCallId: text(200).optional(),
  /** Present when the call was routed via a listing-specific tracking number/deep link (item 3's
   * "identify listing/property/development where possible"). */
  listingId: id.optional(),
}).strict();

export const voiceIdentityVerifySchema = z.object({
  phone,
  email: z.string().trim().email(),
}).strict();

export const outboundArtisanCallSchema = z.object({
  dispatchAttemptId: id,
}).strict();

export const artisanCallResponseSchema = z.object({
  response: z.enum(["AVAILABLE", "UNAVAILABLE", "AVAILABLE_AT_TIME", "NEEDS_INFO"]),
  scheduledAt: z.coerce.date().optional(),
  note: text(1000).optional(),
}).strict();

export const outboundProspectCallSchema = z.object({
  marketplaceLeadId: id,
  purpose: z.enum(["VIEWING_CONFIRMATION", "FOLLOW_UP", "CALLBACK", "ALTERNATIVE_OFFER"]),
}).strict();

export const outboundTenantCallSchema = z.object({
  tenantOrganisationId: id,
  purpose: z.enum(["LEASE_EXPIRY_REMINDER", "VIEWING_ACCESS_COORDINATION", "MAINTENANCE_APPOINTMENT_CONFIRMATION", "MOVE_IN_OUT_COORDINATION"]),
}).strict();

export const handoffRequestSchema = z.object({
  reason: text(2000),
  urgency: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
}).strict();

export const completeCallSchema = z.object({
  status: z.enum(["COMPLETED", "FAILED", "NO_ANSWER", "BUSY", "CANCELED"]),
  durationSeconds: z.coerce.number().int().min(0).max(86_400).optional(),
  transcriptText: z.string().trim().max(50_000).optional(),
  aiSummary: z.string().trim().max(4_000).optional(),
  outcome: z.enum(["NONE", "INFORMATION_PROVIDED", "LEAD_CAPTURED", "VIEWING_SCHEDULED", "MAINTENANCE_REQUEST_CREATED", "ARTISAN_ACCEPTED", "ARTISAN_DECLINED", "ARTISAN_NO_RESPONSE", "HANDED_OFF_TO_HUMAN", "NO_ACTION", "FAILED"]).optional(),
  failureReason: text(500).optional(),
}).strict();

export const listVoiceCallsSchema = z.object({
  status: z.enum(["QUEUED", "RINGING", "IN_PROGRESS", "COMPLETED", "FAILED", "NO_ANSWER", "BUSY", "CANCELED"]).optional(),
  direction: z.enum(["INBOUND", "OUTBOUND"]).optional(),
  aiEmployeeId: id.optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

export const contactPreferenceSchema = z.object({
  phoneNumber: phone,
  doNotCall: z.boolean().default(true),
  reason: text(500).optional(),
}).strict();

export const captureVoiceLeadSchema = z.object({
  listingId: id,
  name: text(160),
  email: z.string().trim().email().max(320).optional(),
  phone: z.string().trim().min(5).max(50).optional(),
  message: z.string().trim().max(5_000).optional(),
}).strict().refine((value) => value.email || value.phone, "An email address or phone number is required.");

// ---------------------------------------------------------------------------
// Phase 22B — phone-number management, persona configuration, realtime, transfer
// ---------------------------------------------------------------------------

export const createPhoneNumberSchema = z.object({
  e164Number: phone,
  providerKey: text(40).default("MOCK"),
  purpose: z.enum(["TENANT_SUPPORT", "SALES", "DEVELOPMENT", "GENERAL_OFFICE"]).default("GENERAL_OFFICE"),
  label: text(120).optional(),
  developmentId: id.optional(),
  inboundEnabled: z.boolean().default(true),
  outboundEnabled: z.boolean().default(false),
  assignedAIEmployeeId: id.optional(),
}).strict();

export const updatePhoneNumberSchema = z.object({
  purpose: z.enum(["TENANT_SUPPORT", "SALES", "DEVELOPMENT", "GENERAL_OFFICE"]).optional(),
  label: text(120).optional(),
  inboundEnabled: z.boolean().optional(),
  outboundEnabled: z.boolean().optional(),
  assignedAIEmployeeId: id.nullable().optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "RELEASED"]).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required.");

export const voicePersonaConfigSchema = z.object({
  employeeDisplayName: text(120).optional(),
  greetingScript: text(2000).optional(),
  businessName: text(160).optional(),
  voiceProfileId: text(200).optional(),
  speakingStyle: text(200).optional(),
  language: z.string().trim().min(2).max(10).default("en"),
  supportedLanguages: z.array(z.string().trim().min(2).max(10)).max(10).default(["en"]),
  escalationPhrase: text(500).optional(),
  officeHoursOverrideStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  officeHoursOverrideEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
}).strict();

export const transcriptChunkSchema = z.object({
  /** A real STT adapter decodes this from real audio. No real audio pipeline exists in this
   * environment, so tests (and any bridge without live audio) supply `simulatedText` instead —
   * see `src/modules/voice/speech.ts`'s module doc comment. */
  audioChunkBase64: z.string().optional(),
  simulatedText: z.string().max(2000).optional(),
  isFinalChunk: z.boolean(),
}).strict().refine((value) => value.audioChunkBase64 !== undefined || value.simulatedText !== undefined, "Provide audioChunkBase64 or simulatedText.");

export const requestTransferSchema = z.object({
  toNumber: phone,
}).strict();

export const sendDigitsSchema = z.object({
  digits: z.string().trim().regex(/^[0-9*#A-D]+$/).min(1).max(32),
}).strict();

// ---------------------------------------------------------------------------
// Phase 22C — media-stream bridge endpoints
// ---------------------------------------------------------------------------

export const mediaStreamConnectSchema = z.object({
  streamToken: text(200),
}).strict();

export const mediaStreamFrameSchema = z.object({
  streamToken: text(200),
  audioChunkBase64: z.string().optional(),
  simulatedText: z.string().max(2000).optional(),
  isFinalChunk: z.boolean(),
}).strict().refine((value) => value.audioChunkBase64 !== undefined || value.simulatedText !== undefined, "Provide audioChunkBase64 or simulatedText.");

export const mediaStreamCloseSchema = z.object({
  streamToken: text(200),
  reason: text(200).optional(),
}).strict();

export { id, text, phone };
