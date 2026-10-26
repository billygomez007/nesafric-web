import { db } from "@/platform/database/client";
import { activatePropertyManagement } from "@/modules/subscriptions/activation";

/**
 * Puts an organisation on a plan as if it had paid for it: activates property management (an
 * organisation has no subscription until then) and switches the subscription to `planKey`, active
 * for the next 30 days. For tests of features gated by a plan; the subscription tests themselves
 * go through checkout and the webhook instead.
 */
export async function onPlan(organisationId: string, planKey: string) {
  if (!(await db.organisationSubscription.findUnique({ where: { organisationId } }))) {
    const owner = await db.organisationMember.findFirstOrThrow({ where: { organisationId }, orderBy: { createdAt: "asc" } });
    await activatePropertyManagement(organisationId, owner.userId);
  }
  return db.organisationSubscription.update({
    where: { organisationId },
    data: { status: "ACTIVE", plan: { connect: { key: planKey } }, currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), expiredAt: null },
  });
}
