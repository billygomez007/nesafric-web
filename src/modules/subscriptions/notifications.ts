import { Prisma } from "@/platform/database/generated/client";
import type { ReminderEventType } from "@/platform/database/generated/client";

type Tx = Prisma.TransactionClient;

/**
 * Creates (or reuses) an organisation-level `IN_APP` notification for a commercial/subscription
 * event (item 12) — the same `Notification` model and delivery pipeline tenant rent reminders
 * use, but with no `leaseId`/`tenantOrganisationId` (there is no tenant recipient) and using the
 * Phase 20-only `ReminderEventType` values so the two families are never confused. `dedupeReference`
 * is the caller's chosen de-duplication key (e.g. a subscription id plus a period marker) since,
 * unlike lease-threshold reminders, these events have no natural `(leaseId, tenantOrganisationId)`
 * pair to key off.
 */
export async function notifySubscriptionEvent(tx: Tx, organisationId: string, eventType: ReminderEventType, dedupeReference: string) {
  const existing = await tx.notification.findFirst({
    where: { organisationId, leaseId: null, tenantOrganisationId: null, eventType, dedupeReference, channel: "IN_APP" },
    select: { id: true },
  });
  if (existing) return existing.id;
  const notification = await tx.notification.create({
    data: { organisationId, eventType, dedupeReference, channel: "IN_APP", scheduledAt: new Date() },
  });
  return notification.id;
}
