import { Prisma } from "@/platform/database/generated/client";
import type { IntegrationType } from "@/platform/database/generated/client";
import { db } from "@/platform/database/client";
import { PERMISSIONS, requirePermission } from "@/platform/authorization/permissions";
import { getObjectStorageAdapter, getMalwareScanner, s3Adapter } from "@/platform/storage";
import { esignatureProviders } from "@/modules/esignature/provider";
import { geocodingProviders } from "@/modules/geocoding/provider";
import { calendarProviders } from "@/modules/calendar/provider";
import { listAvailablePaymentProviders } from "@/modules/payments/service";
// Side-effect import: ensures the Ghana gateway adapters are registered before listing them.
import "@/modules/payments/gateways";
import { upsertIntegrationConfigSchema } from "./schemas";
import { assertOperational } from "@/modules/entitlements/service";
import { ENTITLEMENTS } from "@/modules/entitlements/catalog";

const json = (value: unknown) => value as Prisma.InputJsonValue;

export type IntegrationOverviewItem = {
  type: string;
  provider: string;
  displayName: string;
  enabled: boolean;
  status: "NOT_CONFIGURED" | "CONNECTED" | "DEGRADED" | "ERROR";
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  lastFailureReason: string | null;
};

/**
 * Records a real health outcome for an organisation-scoped Phase 19 integration (item 7).
 * `status` degrades gracefully: a failure right after a success is `DEGRADED` (was working,
 * currently isn't); repeated/first-time failure is `ERROR`. Never stores secrets — `provider` is
 * just the adapter key, `reason` is a human-readable failure summary, not credentials.
 */
export async function recordIntegrationOutcome(organisationId: string, integrationType: IntegrationType, provider: string, outcome: "SUCCESS" | "FAILURE", reason?: string) {
  const now = new Date();
  const existing = await db.integrationConfig.findUnique({ where: { organisationId_integrationType: { organisationId, integrationType } } });
  const status = outcome === "SUCCESS" ? "CONNECTED" : existing?.status === "CONNECTED" ? "DEGRADED" : "ERROR";
  await db.integrationConfig.upsert({
    where: { organisationId_integrationType: { organisationId, integrationType } },
    create: {
      organisationId, integrationType, provider, enabled: true, status,
      lastSuccessAt: outcome === "SUCCESS" ? now : null,
      lastFailureAt: outcome === "FAILURE" ? now : null,
      lastFailureReason: outcome === "FAILURE" ? (reason ?? null) : null,
    },
    update: {
      provider, status,
      ...(outcome === "SUCCESS" ? { lastSuccessAt: now } : { lastFailureAt: now, lastFailureReason: reason ?? null }),
    },
  });
  const eventName = outcome === "SUCCESS" ? "integration.connected" : "integration.failed";
  const entityId = `${organisationId}:${integrationType}`;
  await db.auditEvent.create({ data: { organisationId, action: eventName, entityType: "integration_config", entityId, metadata: json({ integrationType, provider, reason: reason ?? null }) } });
  await db.domainEvent.create({ data: { organisationId, name: eventName, aggregateType: "integration_config", aggregateId: entityId, payload: json({ integrationType, provider, reason: reason ?? null }) } });
}

export async function upsertIntegrationConfig(userId: string, organisationId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.integrationManage);
  const data = upsertIntegrationConfigSchema.parse(input);
  // Representative entitlement check (item 2): enabling an optional third-party integration
  // (e-signature/geocoding/calendar) is plan-gated. Storage and malware scanning are core
  // infrastructure with a deterministic, always-available fallback (see docs/architecture.md) and
  // are never gated behind this entitlement, and disabling an integration is always allowed.
  const gatedTypes = new Set(["ESIGNATURE", "GEOCODING", "CALENDAR"]);
  if (data.enabled && gatedTypes.has(data.integrationType)) {
    await assertOperational(organisationId, ENTITLEMENTS.integrationsEnabled.key);
  }
  const provider = defaultProviderFor(data.integrationType);
  return db.integrationConfig.upsert({
    where: { organisationId_integrationType: { organisationId, integrationType: data.integrationType } },
    create: { organisationId, integrationType: data.integrationType, provider, enabled: data.enabled, metadata: json(data.metadata ?? {}), updatedByUserId: userId },
    update: { enabled: data.enabled, metadata: json(data.metadata ?? {}), updatedByUserId: userId },
  });
}

function defaultProviderFor(integrationType: IntegrationType) {
  // A switch (rather than an object literal) so each branch is only evaluated when actually
  // selected — `getObjectStorageAdapter()` now throws in a cloud deployment with no durable
  // storage configured, which must never surface just from configuring an unrelated integration
  // (e.g. enabling e-signature) that happens to share this lookup helper.
  switch (integrationType) {
    case "STORAGE":
      try {
        return getObjectStorageAdapter().providerKey;
      } catch {
        return "unconfigured";
      }
    case "ESIGNATURE": return esignatureProviders.get("HTTP_ENVELOPE").isConfigured() ? "HTTP_ENVELOPE" : "INTERNAL";
    case "GEOCODING": return geocodingProviders.get("http").isConfigured() ? "http" : "deterministic-fallback";
    case "CALENDAR": return calendarProviders.get("HTTP_CALENDAR").isConfigured() ? "HTTP_CALENDAR" : "INTERNAL";
    case "MALWARE_SCAN": return getMalwareScanner().providerKey;
  }
}

/**
 * Unified, non-secret organisation integration status view (item 7 + item 8): every Phase 19
 * adapter category plus existing communication-channel and payment-provider readiness, in one
 * response the settings UI can render directly — never a raw secret, never a credential.
 */
export async function getOrganisationIntegrationOverview(userId: string, organisationId: string): Promise<IntegrationOverviewItem[]> {
  await requirePermission(userId, organisationId, PERMISSIONS.integrationRead);
  const configs = await db.integrationConfig.findMany({ where: { organisationId } });
  const configByType = new Map(configs.map((config) => [config.integrationType, config]));

  const adapterHealth = (type: IntegrationType, provider: string, displayName: string, isAvailable: boolean): IntegrationOverviewItem => {
    const config = configByType.get(type);
    if (config) {
      return { type, provider: config.provider, displayName, enabled: config.enabled, status: config.status, lastSuccessAt: config.lastSuccessAt, lastFailureAt: config.lastFailureAt, lastFailureReason: config.lastFailureReason };
    }
    return { type, provider, displayName, enabled: isAvailable, status: isAvailable ? "CONNECTED" : "NOT_CONFIGURED", lastSuccessAt: null, lastFailureAt: null, lastFailureReason: null };
  };

  /**
   * `recordIntegrationOutcome("STORAGE", ...)` is written every time *any* configured adapter
   * (including the local-filesystem/in-memory fallback) successfully writes an object, so the
   * `IntegrationConfig` row can end up with `status: "CONNECTED"` purely because uploads work in
   * dev/test — never a signal that this organisation has a production object store. Production
   * readiness is defined solely by real S3-compatible credentials being configured. This reports
   * that truthfully while still preserving the recorded operation history (`lastSuccessAt` /
   * `lastFailureAt` / `lastFailureReason`) for observability, including right after an upload.
   */
  const storageOverviewItem = (config: (typeof configs)[number] | undefined): IntegrationOverviewItem => {
    const productionReady = s3Adapter.isConfigured();
    const status: IntegrationOverviewItem["status"] = productionReady
      ? (config?.status ?? "CONNECTED")
      : config?.lastFailureAt
        ? "DEGRADED"
        : "NOT_CONFIGURED";
    const currentProviderKey = (() => {
      try {
        return getObjectStorageAdapter().providerKey;
      } catch {
        // Cloud deployment, no durable storage configured — this display value must say so
        // truthfully without crashing the overview page whose entire purpose is showing exactly
        // that state.
        return "unconfigured";
      }
    })();
    return {
      type: "STORAGE",
      provider: config?.provider ?? currentProviderKey,
      displayName: "Object storage",
      enabled: config?.enabled ?? productionReady,
      status,
      lastSuccessAt: config?.lastSuccessAt ?? null,
      lastFailureAt: config?.lastFailureAt ?? null,
      lastFailureReason: config?.lastFailureReason ?? null,
    };
  };

  const items: IntegrationOverviewItem[] = [
    // Storage health reflects production-readiness (a real S3-compatible provider), not just "an adapter happens to work" — the local/in-memory fallback is fully functional for uploads/downloads but is not a production object store.
    storageOverviewItem(configByType.get("STORAGE")),
    adapterHealth("ESIGNATURE", esignatureProviders.get("HTTP_ENVELOPE").isConfigured() ? "HTTP_ENVELOPE" : "INTERNAL", "E-signature", esignatureProviders.get("HTTP_ENVELOPE").isConfigured()),
    adapterHealth("GEOCODING", geocodingProviders.get("http").isConfigured() ? "http" : "deterministic-fallback", "Geocoding", geocodingProviders.get("http").isConfigured()),
    adapterHealth("CALENDAR", calendarProviders.get("HTTP_CALENDAR").isConfigured() ? "HTTP_CALENDAR" : "INTERNAL", "Calendar sync", calendarProviders.get("HTTP_CALENDAR").isConfigured()),
    adapterHealth("MALWARE_SCAN", getMalwareScanner().providerKey, "Malware scanning", getMalwareScanner().isConfigured()),
  ];

  const channelConfigs = await db.communicationChannelConfig.findMany({ where: { organisationId } });
  for (const channel of channelConfigs) {
    items.push({
      type: `COMMUNICATION_${channel.channel}`,
      provider: channel.providerKey ?? "unconfigured",
      displayName: `${channel.channel} channel`,
      enabled: channel.enabled,
      status: channel.enabled && channel.providerKey ? "CONNECTED" : "NOT_CONFIGURED",
      lastSuccessAt: null,
      lastFailureAt: null,
      lastFailureReason: null,
    });
  }

  for (const provider of listAvailablePaymentProviders()) {
    items.push({
      type: `PAYMENT_${provider.key.toUpperCase().replaceAll("-", "_")}`,
      provider: provider.key,
      displayName: provider.displayName,
      enabled: provider.available,
      status: provider.available ? "CONNECTED" : "NOT_CONFIGURED",
      lastSuccessAt: null,
      lastFailureAt: null,
      lastFailureReason: null,
    });
  }

  return items;
}
