import { createHash } from "node:crypto";
import { db } from "@/platform/database/client";
import { notFound } from "@/platform/errors";

/**
 * Feature flags (item 10): entirely separate from RBAC/entitlements. A flag gates whether a
 * capability is *rolled out* (e.g. a new UI, an experimental workflow); entitlements gate whether
 * an organisation's *plan* includes a capability. The two are never conflated.
 *
 * Evaluation order, each one able to fully override the next:
 *   1. `emergencyDisabled` — a global kill switch. Always wins; forces the flag off for everyone.
 *   2. An active `OrganisationFeatureFlagOverride` for this organisation.
 *   3. A deterministic percentage-cohort hash of `(organisationId, key)` against `rolloutPercentage`.
 *   4. The flag's base `isEnabled`.
 */
function stableCohortPercent(organisationId: string, flagKey: string) {
  const digest = createHash("sha256").update(`${flagKey}:${organisationId}`).digest();
  // First 4 bytes as an unsigned 32-bit integer gives a stable, uniformly distributed [0, 100) bucket.
  const bucket = digest.readUInt32BE(0) % 100;
  return bucket;
}

export async function isFeatureEnabled(flagKey: string, organisationId?: string): Promise<boolean> {
  const flag = await db.featureFlag.findUnique({ where: { key: flagKey } });
  if (!flag) return false;
  if (flag.emergencyDisabled) return false;
  if (organisationId) {
    const override = await db.organisationFeatureFlagOverride.findUnique({ where: { organisationId_flagKey: { organisationId, flagKey } } });
    if (override) return override.enabled;
  }
  if (flag.rolloutPercentage >= 100) return flag.isEnabled;
  if (flag.rolloutPercentage <= 0) return false;
  if (!organisationId) return flag.isEnabled;
  return flag.isEnabled && stableCohortPercent(organisationId, flagKey) < flag.rolloutPercentage;
}

export async function listFeatureFlags() {
  return db.featureFlag.findMany({ orderBy: { key: "asc" }, include: { organisationOverrides: { select: { organisationId: true, enabled: true } } } });
}

export async function getFeatureFlagOrThrow(flagKey: string) {
  const flag = await db.featureFlag.findUnique({ where: { key: flagKey } });
  if (!flag) throw notFound();
  return flag;
}
