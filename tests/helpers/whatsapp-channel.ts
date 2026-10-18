import { randomUUID } from "node:crypto";
import { registerUser } from "@/modules/identity/service";
import { upsertChannelConfig } from "@/modules/conversations/service";
import { assignWhatsAppNumberForPlatform } from "@/modules/platform-admin/service";
import { db } from "@/platform/database/client";

/** A SUPER_ADMIN platform principal for tests that need platform-only actions. */
export async function createPlatformAdmin() {
  const user = await registerUser({ displayName: "NesAfric Platform", email: `platform-${randomUUID()}@example.com`, password: "secure-password-123" });
  return db.platformPrincipal.create({ data: { userId: user.id, role: "SUPER_ADMIN", status: "ACTIVE", createdVia: "MANUAL" } });
}

/**
 * Connects an organisation's WhatsApp channel the way production does: NesAfric assigns the
 * number, then the organisation's owner saves the rest of the channel settings.
 */
export async function connectWhatsAppChannel(ownerUserId: string, organisationId: string, input: { enabled: boolean; webhookVerifyToken?: string; config: { phoneNumberId: string; businessAccountId?: string } & Record<string, unknown> }) {
  const { phoneNumberId, businessAccountId, ...settings } = input.config;
  await assignWhatsAppNumberForPlatform(await createPlatformAdmin(), { organisationId, phoneNumberId, businessAccountId, reason: "Test channel setup" });
  return upsertChannelConfig(ownerUserId, organisationId, "WHATSAPP", { ...input, config: settings });
}
