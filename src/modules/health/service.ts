import { db } from "@/platform/database/client";
import { getMalwareScanner, s3Adapter } from "@/platform/storage";
import { esignatureProviders } from "@/modules/esignature/provider";
import { geocodingProviders } from "@/modules/geocoding/provider";
import { calendarProviders } from "@/modules/calendar/provider";
import { listAvailablePaymentProviders } from "@/modules/payments/service";
// Side-effect import: registers the Ghana payment gateway adapters before listing them.
import "@/modules/payments/gateways";
import { resolveDefaultBillingProviderKey } from "@/modules/billing/service";
import { getEmailProviderStatus } from "@/modules/conversations/channels/email-providers";

/**
 * Public, unauthenticated health surface (item 15). Deliberately reports only
 * configured-vs-unconfigured/deferred flags per integration — never a secret, never an org-scoped
 * detail (that richer view already exists at `getOrganisationIntegrationOverview` and the
 * platform-admin `getPlatformHealth`, both of which require authentication). An optional
 * integration being unconfigured must never make `status` anything other than "HEALTHY" — only a
 * real Postgres outage does that, since Postgres is the one dependency nothing in this app can
 * function without.
 */
export type ProviderReadiness = "CONFIGURED" | "TEST_MODE" | "DEFERRED" | "UNCONFIGURED";

export type ProviderHealthEntry = { name: string; readiness: ProviderReadiness; detail: string };

function envPresent(...names: string[]) {
  return names.every((name) => Boolean(process.env[name]?.trim()));
}

async function checkDatabase(): Promise<{ status: "UP" | "DOWN"; latencyMs: number; error?: string }> {
  const startedAt = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    return { status: "UP", latencyMs: Date.now() - startedAt };
  } catch (error) {
    return { status: "DOWN", latencyMs: Date.now() - startedAt, error: error instanceof Error ? error.message : "Unknown database error." };
  }
}

function checkBackgroundWorker(): ProviderHealthEntry {
  // The worker is an in-process job-claim loop (no separate deployable process in this
  // environment) — see `src/modules/*/worker.ts` claim/retry logic. Its "configured" signal is
  // therefore always CONFIGURED; genuine failures show up as `FAILED` `BackgroundJob` rows, which
  // the authenticated platform-admin health view (`getPlatformHealth`) already surfaces.
  return { name: "backgroundWorker", readiness: "CONFIGURED", detail: "In-process job worker; failed-job detail is available via authenticated platform-admin health." };
}

function checkAI(): ProviderHealthEntry {
  const configured = Boolean(process.env.AI_PROVIDER_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim());
  return { name: "ai", readiness: configured ? "CONFIGURED" : "TEST_MODE", detail: configured ? "External AI provider credentials are set." : "Deterministic AI mode (no external model credentials configured)." };
}

function checkPayments(): ProviderHealthEntry {
  const providers = listAvailablePaymentProviders();
  const configured = providers.some((provider) => provider.available);
  return { name: "payments", readiness: configured ? "CONFIGURED" : "TEST_MODE", detail: configured ? `${providers.filter((p) => p.available).length} live collection gateway(s) configured.` : "No live Ghana payment gateway credentials configured; manual/test payments only." };
}

function checkBilling(): ProviderHealthEntry {
  const providerKey = resolveDefaultBillingProviderKey();
  return { name: "saasBilling", readiness: providerKey === "http" ? "CONFIGURED" : "TEST_MODE", detail: providerKey === "http" ? "External billing provider configured." : "Deterministic test billing adapter (no external billing credentials configured)." };
}

/** Private and public object storage are two physically separate buckets (Ghana Card evidence
 * must never share infrastructure with public campaign/listing media) and are reported
 * independently — a deployment can have one durably configured and not the other, and that must
 * be visible rather than collapsed into a single misleading flag. Never exposes bucket
 * names/endpoints/credentials, only whether each side is usable. */
function checkStorage(): ProviderHealthEntry[] {
  const privateConfigured = s3Adapter.isPrivateConfigured();
  const publicConfigured = s3Adapter.isPublicConfigured();
  return [
    {
      name: "storagePrivate",
      readiness: privateConfigured ? "CONFIGURED" : "UNCONFIGURED",
      detail: privateConfigured
        ? "Private object storage (identity evidence, generated documents) is durably configured."
        : "Private object storage is not configured — permanent uploads requiring privacy (Ghana Card, business registration, licences) will fail closed rather than use non-durable local storage.",
    },
    {
      name: "storagePublic",
      readiness: publicConfigured ? "CONFIGURED" : "UNCONFIGURED",
      detail: publicConfigured
        ? "Public object storage (campaign creative, listing/property media) is durably configured."
        : "Public object storage is not configured — permanent public uploads will fail closed rather than use non-durable local storage.",
    },
  ];
}

function checkMalwareScan(): ProviderHealthEntry {
  const configured = getMalwareScanner().isConfigured();
  return { name: "malwareScan", readiness: configured ? "CONFIGURED" : "UNCONFIGURED", detail: configured ? "Malware scan hook configured." : "Uploads are stored unscanned." };
}

function checkESignature(): ProviderHealthEntry {
  const configured = esignatureProviders.get("HTTP_ENVELOPE").isConfigured();
  return { name: "esignature", readiness: configured ? "CONFIGURED" : "TEST_MODE", detail: configured ? "External e-signature provider configured." : "Internal, non-legal signing flow only." };
}

function checkGeocoding(): ProviderHealthEntry {
  const configured = geocodingProviders.get("http").isConfigured();
  return { name: "geocoding", readiness: configured ? "CONFIGURED" : "UNCONFIGURED", detail: configured ? "External geocoding provider configured." : "Deterministic known-location fallback only." };
}

function checkCalendar(): ProviderHealthEntry {
  const configured = calendarProviders.get("HTTP_CALENDAR").isConfigured();
  return { name: "calendar", readiness: configured ? "CONFIGURED" : "UNCONFIGURED", detail: configured ? "External calendar sync configured." : "Calendar events remain internal-only." };
}

function checkCommunications(): ProviderHealthEntry[] {
  const email = getEmailProviderStatus();
  return [
    { name: "sms", readiness: envPresent("SMS_PROVIDER_SEND_URL", "SMS_PROVIDER_API_KEY") ? "CONFIGURED" : "TEST_MODE", detail: "Provider-neutral SMS transport." },
    { name: "whatsapp", readiness: envPresent("WHATSAPP_PROVIDER_SEND_URL", "WHATSAPP_PROVIDER_ACCESS_TOKEN") ? "CONFIGURED" : "TEST_MODE", detail: "Provider-neutral WhatsApp transport." },
    {
      name: "email",
      readiness: email.configured ? "CONFIGURED" : "TEST_MODE",
      detail: email.configured ? "Resend (notifications@umoafric.com)." : "Simulated in-memory email transport (no external send occurs).",
    },
  ];
}

function checkVoice(): ProviderHealthEntry {
  // Voice architecture is intentionally deferred (Phase 22C decision): the media bridge, STT/TTS
  // adapters, and runtime enforcement are all real and tested, but a real inbound/outbound call
  // additionally requires Twilio credentials, real STT/TTS provider credentials, and a deployed
  // standalone WebSocket media-bridge process, none of which exist by default. This check reports
  // the environment-level signal only (each organisation's own per-number config is separate and
  // authenticated — see `getVoiceHealthStatus`).
  const telephonyConfigured = envPresent("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN");
  const speechConfigured = envPresent("STT_PROVIDER_API_KEY") && envPresent("TTS_PROVIDER_API_KEY");
  const bridgeDeployed = Boolean(process.env.VOICE_MEDIA_SWEEP_SECRET?.trim());
  const configured = telephonyConfigured && speechConfigured && bridgeDeployed;
  return {
    name: "voice",
    readiness: configured ? "CONFIGURED" : "DEFERRED",
    detail: configured
      ? "Telephony, STT/TTS, and media-bridge infrastructure signals are all present."
      : "Voice architecture is present in the codebase; live telephony is intentionally deferred pending Twilio/STT/TTS credentials and a deployed media-bridge process.",
  };
}

export async function getPublicHealth() {
  const database = await checkDatabase();
  const providers: ProviderHealthEntry[] = [
    checkBackgroundWorker(),
    checkAI(),
    checkPayments(),
    checkBilling(),
    ...checkStorage(),
    checkMalwareScan(),
    checkESignature(),
    checkGeocoding(),
    checkCalendar(),
    ...checkCommunications(),
    checkVoice(),
  ];
  return {
    status: database.status === "UP" ? ("HEALTHY" as const) : ("UNHEALTHY" as const),
    timestamp: new Date().toISOString(),
    application: { status: "UP" as const },
    database,
    providers,
  };
}
