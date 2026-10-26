import { db } from "@/platform/database/client";
import { enqueueSubscriptionNoticeEmail } from "@/modules/account-emails/service";
import { formatDate } from "./plans";
import { PM_BILLING_RULES } from "./plan-catalog";

type Notice = { subject: string; paragraphs: string[] };

const KEEP_DATA = "Your properties, tenants, leases, maintenance history and documents are all kept. You can still view and export them, and the marketplace is unaffected.";

/**
 * The words of every property-management plan notice, built from the subscription's real dates
 * and plan, so the email always matches what the billing page shows. Returns null for an event
 * that has no owner email.
 */
export async function subscriptionNotice(organisationId: string, eventType: string): Promise<Notice | null> {
  const subscription = await db.organisationSubscription.findUnique({
    where: { organisationId },
    include: { plan: { select: { name: true } }, selectedPlan: { select: { name: true } }, organisation: { select: { name: true } } },
  });
  if (!subscription) return null;
  const workspace = subscription.organisation.name;
  const trialEnd = subscription.trialEndsAt ? formatDate(subscription.trialEndsAt) : null;
  switch (eventType) {
    case "SUBSCRIPTION_TRIAL_STARTED":
      return { subject: "Your free property-management trial has started", paragraphs: [`Property management is now active for ${workspace}.`, `Your ${PM_BILLING_RULES.trialDays}-day free trial ends on ${trialEnd}. We will remind you 7, 3 and 1 days before it ends.`, "No payment is taken automatically. Choose a plan from Billing whenever you are ready."] };
    case "SUBSCRIPTION_TRIAL_REMINDER":
      return { subject: `Your free trial ends on ${trialEnd}`, paragraphs: [`The property-management trial for ${workspace} ends on ${trialEnd}.`, "Choose a plan before then to keep tenant assistance, maintenance automation and reminders running without interruption.", "Nothing is charged automatically."] };
    case "SUBSCRIPTION_EXPIRED":
      return { subject: "Your property-management plan is paused", paragraphs: [`Property-management features for ${workspace} are paused because there is no active paid plan.`, KEEP_DATA, "Tenants can still report maintenance; you will see their reports. Choose a plan to switch everything back on."] };
    case "SUBSCRIPTION_PLAN_SELECTED":
      return { subject: `You chose the ${subscription.selectedPlan?.name ?? "selected"} plan`, paragraphs: [`${subscription.selectedPlan?.name ?? "Your chosen plan"} will start as soon as its payment is confirmed.`, trialEnd && subscription.status === "TRIALING" ? `Your trial continues until ${trialEnd}; paying early keeps the remaining trial days.` : "Complete payment from Billing to activate it."] };
    case "SUBSCRIPTION_ACTIVATED":
      return { subject: `Your ${subscription.plan.name} plan is active`, paragraphs: [`Payment confirmed. ${workspace} is on the ${subscription.plan.name} plan until ${formatDate(subscription.currentPeriodEnd)}.`] };
    case "SUBSCRIPTION_RENEWED":
      return { subject: "Your plan has been renewed", paragraphs: [`${workspace} remains on the ${subscription.plan.name} plan until ${formatDate(subscription.currentPeriodEnd)}.`] };
    case "SUBSCRIPTION_PAYMENT_FAILED":
      return { subject: "Your payment did not go through", paragraphs: ["The payment provider did not confirm your payment, so nothing was charged and your plan has not changed.", "You can try again from Billing."] };
    case "SUBSCRIPTION_BILLING_ISSUE":
      return { subject: "Your plan renewal is due", paragraphs: [`The ${subscription.plan.name} plan for ${workspace} needs its renewal payment.`, `Everything keeps working for now. If no payment is confirmed within ${PM_BILLING_RULES.pastDueDays + PM_BILLING_RULES.gracePeriodDays} days, management features will pause. Your data is always kept.`] };
    case "SUBSCRIPTION_GRACE_PERIOD":
      return { subject: "Grace period: renew to avoid a pause", paragraphs: [`Your renewal payment is still outstanding. Management features keep working until ${subscription.gracePeriodEndsAt ? formatDate(subscription.gracePeriodEndsAt) : "the end of the grace period"}.`, KEEP_DATA] };
    case "SUBSCRIPTION_CANCELLED":
      return { subject: "Your plan cancellation", paragraphs: [subscription.status === "CANCELLED" ? "Your property-management plan has been cancelled and will not renew." : `Your plan will not renew. It stays active until ${formatDate(subscription.currentPeriodEnd)}.`, KEEP_DATA] };
    case "SUBSCRIPTION_CHANGED":
      return { subject: "Your plan change is scheduled", paragraphs: [`From your next renewal on ${formatDate(subscription.currentPeriodEnd)}, ${workspace} moves to the ${subscription.selectedPlan?.name ?? "new"} plan.`, "If you use more than the new plan allows, nothing is deleted; adding more is paused until you are within the limit."] };
    case "SUBSCRIPTION_SUSPENDED":
      return { subject: "Your account needs attention", paragraphs: ["Property-management features are suspended. Please contact NesAfric support.", KEEP_DATA] };
    case "SUBSCRIPTION_UNIT_LIMIT_REACHED":
      return { subject: "You have reached your unit limit", paragraphs: [`${workspace} is using every managed unit its plan includes. Existing units are unaffected; upgrade to add more.`] };
    default:
      return null;
  }
}

/** Emails a plan notice to every active owner of the organisation. Idempotent per notification. */
export async function enqueueSubscriptionNoticeEmails(organisationId: string, notificationId: string, eventType: string) {
  const notice = await subscriptionNotice(organisationId, eventType);
  if (!notice) return;
  const owners = await db.organisationMember.findMany({
    where: { organisationId, status: "ACTIVE", archivedAt: null, roles: { some: { role: { key: "organisation_owner" } } } },
    select: { userId: true },
  });
  for (const owner of owners) await enqueueSubscriptionNoticeEmail(owner.userId, notificationId, notice);
}
