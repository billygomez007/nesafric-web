import { db } from "@/platform/database/client";
import { PERMISSIONS } from "@/platform/authorization/permissions";
import { notFound, AppError } from "@/platform/errors";
import { requireVoiceAccess } from "./service";
import { getVoiceProviderConfig } from "./service";
import { isLanguageDeliverable } from "./speech";
import { voicePersonaConfigSchema } from "./schemas";

/**
 * Voice-persona configuration (Phase 22B item 10). Purely presentational/operational — greeting
 * text, display name, voice profile id, language — never consulted by any authorization,
 * entitlement, autonomy, or tool-permission check anywhere in this codebase, so no combination of
 * persona fields can ever override system safety policy (item 10's explicit constraint). It is
 * read only at the point of *speaking* (building the greeting/TTS request), never at the point of
 * deciding *what the AI is allowed to do*.
 */

async function loadEmployeeForOrganisation(organisationId: string, aiEmployeeId: string) {
  const employee = await db.aIEmployee.findFirst({
    where: { id: aiEmployeeId, OR: [{ organisationId }, { marketplaceProfessional: { backingOrganisationId: organisationId } }] },
  });
  if (!employee) throw notFound();
  return employee;
}

export async function getVoicePersonaConfig(userId: string, organisationId: string, aiEmployeeId: string) {
  await requireVoiceAccess(userId, organisationId, PERMISSIONS.aiEmployeeRead);
  await loadEmployeeForOrganisation(organisationId, aiEmployeeId);
  return db.voicePersonaConfig.findUnique({ where: { aiEmployeeId } });
}

export async function setVoicePersonaConfig(userId: string, organisationId: string, aiEmployeeId: string, input: unknown) {
  await requireVoiceAccess(userId, organisationId, PERMISSIONS.aiAutonomyManage, "ADMIN");
  await loadEmployeeForOrganisation(organisationId, aiEmployeeId);
  const data = voicePersonaConfigSchema.parse(input);

  const config = await getVoiceProviderConfig(userId, organisationId);
  const undeliverable = data.supportedLanguages.filter((language) => !isLanguageDeliverable(config.sttProviderKey, config.ttsProviderKey, language));
  if (undeliverable.length > 0) {
    throw new AppError(
      "VOICE_LANGUAGE_NOT_DELIVERABLE",
      422,
      `The configured speech providers cannot actually deliver: ${undeliverable.join(", ")}. Configure a provider that supports these languages first, or remove them.`,
    );
  }
  if (!isLanguageDeliverable(config.sttProviderKey, config.ttsProviderKey, data.language)) {
    throw new AppError("VOICE_LANGUAGE_NOT_DELIVERABLE", 422, `The configured speech providers cannot actually deliver '${data.language}'.`);
  }

  return db.voicePersonaConfig.upsert({
    where: { aiEmployeeId },
    update: data,
    create: { ...data, aiEmployeeId },
  });
}
