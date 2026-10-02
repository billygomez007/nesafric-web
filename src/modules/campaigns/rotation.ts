import { z } from "zod";
import type { PlatformPrincipal, $Enums } from "@/platform/database/generated/client";
import { db } from "@/platform/database/client";
import { AppError } from "@/platform/errors";
import { PLATFORM_PERMISSIONS, platformRoleHasPermission } from "@/platform/platform-admin/permissions";
import { recordPlatformAudit } from "@/modules/platform-admin/service";
import { ALL_PLACEMENTS } from "./schemas";

/** How long each campaign stays on screen before a carousel advances.
 * Each campaign placement keeps an independent rotation setting. */
export const ROTATION_SECONDS_OPTIONS = [5, 8, 10] as const;
export type RotationSeconds = (typeof ROTATION_SECONDS_OPTIONS)[number];
export const DEFAULT_ROTATION_SECONDS: RotationSeconds = 5;

export function isRotationSeconds(value: unknown): value is RotationSeconds {
  return ROTATION_SECONDS_OPTIONS.includes(value as RotationSeconds);
}

const placementSchema = z.enum(ALL_PLACEMENTS);
const updateRotationSchema = z.object({
  rotationSeconds: z.number().int().refine(isRotationSeconds, { message: "Rotation must be 5, 8 or 10 seconds." }),
}).strict();

/** The placement's rotation; the default when Super Admin has never changed it. */
export async function getPlacementRotationSeconds(placement: $Enums.CampaignPlacement): Promise<RotationSeconds> {
  const setting = await db.campaignPlacementSetting.findUnique({ where: { placement }, select: { rotationSeconds: true } });
  return setting && isRotationSeconds(setting.rotationSeconds) ? setting.rotationSeconds : DEFAULT_ROTATION_SECONDS;
}

export async function getPlacementRotationForPlatform(principal: PlatformPrincipal, placement: unknown) {
  requireCampaignReview(principal);
  const parsed = placementSchema.parse(placement);
  return { placement: parsed, rotationSeconds: await getPlacementRotationSeconds(parsed), options: ROTATION_SECONDS_OPTIONS };
}

export async function setPlacementRotation(principal: PlatformPrincipal, placement: unknown, input: unknown) {
  requireCampaignReview(principal);
  const parsed = placementSchema.parse(placement);
  const { rotationSeconds } = updateRotationSchema.parse(input);
  const previous = await getPlacementRotationSeconds(parsed);
  await db.campaignPlacementSetting.upsert({
    where: { placement: parsed },
    create: { placement: parsed, rotationSeconds, updatedByPlatformPrincipalId: principal.id },
    update: { rotationSeconds, updatedByPlatformPrincipalId: principal.id },
  });
  await recordPlatformAudit(principal, "platform_admin.campaign_rotation_updated", "campaign_placement", parsed, undefined, { previous, rotationSeconds });
  return { placement: parsed, rotationSeconds, options: ROTATION_SECONDS_OPTIONS };
}

function requireCampaignReview(principal: PlatformPrincipal) {
  if (!platformRoleHasPermission(principal.role, PLATFORM_PERMISSIONS.campaignReview)) throw new AppError("FORBIDDEN", 403, "You do not have permission to manage campaigns.");
}
