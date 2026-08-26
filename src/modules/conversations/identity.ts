import { db } from "@/platform/database/client";

export type IdentitySignals = {
  userId?: string;
  email?: string;
  phone?: string;
};

export type IdentityResolution = {
  level: "NONE" | "CLAIMED" | "VERIFIED";
  tenantOrganisationId: string | null;
};

const noIdentity: IdentityResolution = { level: "NONE", tenantOrganisationId: null };

/**
 * Resolve a conversation participant's identity against organisation tenant records.
 *
 * A verified session (`userId` from an authenticated cookie) that matches a
 * `TenantOrganisation.userId` in this organisation is the only path to VERIFIED.
 * A bare email/phone claim from an inbound channel (email header, WhatsApp/SMS
 * sender number, unauthenticated web chat form) can only ever reach CLAIMED -
 * enough to route the conversation, never enough to expose private data.
 */
export async function resolveTenantIdentity(organisationId: string, signals: IdentitySignals): Promise<IdentityResolution> {
  if (signals.userId) {
    const verified = await db.tenantOrganisation.findFirst({
      where: { organisationId, userId: signals.userId, archivedAt: null },
      select: { id: true },
    });
    if (verified) return { level: "VERIFIED", tenantOrganisationId: verified.id };
  }
  if (signals.email || signals.phone) {
    const claimed = await db.tenantOrganisation.findFirst({
      where: {
        organisationId,
        archivedAt: null,
        OR: [
          ...(signals.email ? [{ email: signals.email }] : []),
          ...(signals.phone ? [{ phone: signals.phone }] : []),
        ],
      },
      select: { id: true },
    });
    if (claimed) return { level: "CLAIMED", tenantOrganisationId: claimed.id };
  }
  return noIdentity;
}

/** Only a VERIFIED identity may see private lease, payment, or tenant records. */
export function canAccessPrivateData(level: IdentityResolution["level"]) {
  return level === "VERIFIED";
}
