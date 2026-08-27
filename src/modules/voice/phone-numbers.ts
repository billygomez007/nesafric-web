import { db } from "@/platform/database/client";
import { PERMISSIONS } from "@/platform/authorization/permissions";
import { notFound, AppError } from "@/platform/errors";
import { requireVoiceAccess } from "./service";
import { createPhoneNumberSchema, updatePhoneNumberSchema } from "./schemas";

/**
 * Phone-number assignment readiness (Phase 22B item 9). Deliberately a thin management layer on
 * top of the `PhoneNumber` table — never invents or purchases a real number, and never stores a
 * provider secret; a real telephony provider's number-purchase API is a separate operational
 * concern this module does not perform.
 */

export async function listPhoneNumbers(userId: string, organisationId: string) {
  await requireVoiceAccess(userId, organisationId, PERMISSIONS.aiEmployeeRead);
  return db.phoneNumber.findMany({ where: { organisationId }, orderBy: { createdAt: "desc" }, include: { assignedAIEmployee: { select: { id: true, name: true, role: true } }, development: { select: { id: true, name: true } } } });
}

export async function createPhoneNumber(userId: string, organisationId: string, input: unknown) {
  await requireVoiceAccess(userId, organisationId, PERMISSIONS.aiAutonomyManage, "ADMIN");
  const data = createPhoneNumberSchema.parse(input);
  if (data.developmentId) {
    const development = await db.development.findFirst({ where: { id: data.developmentId, marketplaceProfessional: { backingOrganisationId: organisationId } } });
    if (!development) throw new AppError("VOICE_PHONE_NUMBER_DEVELOPMENT_NOT_FOUND", 404, "This development does not belong to this organisation.");
  }
  if (data.assignedAIEmployeeId) {
    const employee = await db.aIEmployee.findFirst({ where: { id: data.assignedAIEmployeeId, OR: [{ organisationId }, { marketplaceProfessional: { backingOrganisationId: organisationId } }] } });
    if (!employee) throw new AppError("VOICE_PHONE_NUMBER_EMPLOYEE_NOT_FOUND", 404, "This AI employee does not belong to this organisation.");
  }
  return db.phoneNumber.create({ data: { ...data, organisationId } });
}

export async function updatePhoneNumber(userId: string, organisationId: string, phoneNumberId: string, input: unknown) {
  await requireVoiceAccess(userId, organisationId, PERMISSIONS.aiAutonomyManage, "ADMIN");
  const data = updatePhoneNumberSchema.parse(input);
  const existing = await db.phoneNumber.findFirst({ where: { id: phoneNumberId, organisationId } });
  if (!existing) throw notFound();
  if (data.assignedAIEmployeeId) {
    const employee = await db.aIEmployee.findFirst({ where: { id: data.assignedAIEmployeeId, OR: [{ organisationId }, { marketplaceProfessional: { backingOrganisationId: organisationId } }] } });
    if (!employee) throw new AppError("VOICE_PHONE_NUMBER_EMPLOYEE_NOT_FOUND", 404, "This AI employee does not belong to this organisation.");
  }
  return db.phoneNumber.update({ where: { id: phoneNumberId }, data });
}

/** Resolves which organisation/phone-number row should answer an inbound call to `toNumber` under
 * `providerKey` (item 9). Checked *before* the legacy `VoiceProviderConfig.phoneNumber` single-
 * number lookup in `startInboundCall` — an organisation that has never configured a `PhoneNumber`
 * row is completely unaffected and keeps routing exactly as it did in Phase 22. */
export async function resolvePhoneNumberRouting(providerKey: string, toNumber: string) {
  const record = await db.phoneNumber.findUnique({
    where: { providerKey_e164Number: { providerKey, e164Number: toNumber } },
    select: { organisationId: true, inboundEnabled: true, status: true, assignedAIEmployeeId: true, purpose: true },
  });
  if (!record || record.status !== "ACTIVE") return null;
  return record;
}
