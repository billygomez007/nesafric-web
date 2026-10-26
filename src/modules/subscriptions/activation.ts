import { createHash } from "node:crypto";
import { Prisma } from "@/platform/database/generated/client";
import { db } from "@/platform/database/client";
import { AppError } from "@/platform/errors";
import { enqueueNotificationDelivery } from "@/modules/notifications/service";
import { resolveDefaultBillingProviderKey } from "@/modules/billing/service";
import { notifySubscriptionEvent } from "./notifications";
import { PM_BILLING_RULES, TRIAL_PLAN_KEY } from "./plan-catalog";

type Tx = Prisma.TransactionClient;

const json = (value: unknown) => value as Prisma.InputJsonValue;
const days = (count: number) => count * 24 * 60 * 60 * 1000;

/** Same format as the `pm_subscription_plans` migration's SQL: sha256 of `kind:value`. */
export function trialIdentityHash(kind: "user" | "email" | "phone", value: string) {
  const normalized = kind === "email" ? value.trim().toLowerCase() : value.trim();
  return createHash("sha256").update(`${kind}:${normalized}`).digest("hex");
}

function managementUnavailable() {
  return new AppError("PM_NOT_AVAILABLE", 403, "Property management is not available for this account type.");
}

/**
 * The people whose identities a trial is tied to: every active owner of the organisation, plus
 * the person activating it. Adding staff never adds a trial, because staff are not owners and a
 * staff member who activates is recorded against the same grant.
 */
async function trialIdentities(tx: Tx, organisationId: string, actorUserId: string | null) {
  const owners = await tx.organisationMember.findMany({
    where: { organisationId, status: "ACTIVE", archivedAt: null, roles: { some: { role: { key: "organisation_owner" } } } },
    select: { user: { select: { id: true, email: true, emailVerifiedAt: true, phoneE164: true } } },
  });
  const users = owners.map((owner) => owner.user);
  if (actorUserId && !users.some((user) => user.id === actorUserId)) {
    const actor = await tx.user.findUnique({ where: { id: actorUserId }, select: { id: true, email: true, emailVerifiedAt: true, phoneE164: true } });
    if (actor) users.push(actor);
  }
  const identities = new Map<string, "user" | "email" | "phone">();
  for (const user of users) {
    identities.set(trialIdentityHash("user", user.id), "user");
    // Only verified contact details identify a person; `phoneE164` is set only once verified.
    if (user.email && user.emailVerifiedAt) identities.set(trialIdentityHash("email", user.email), "email");
    if (user.phoneE164) identities.set(trialIdentityHash("phone", user.phoneE164), "phone");
  }
  return identities;
}

/**
 * Activates property management for an organisation: the moment its free trial starts. Idempotent
 * and safe under concurrency — an advisory lock per organisation serialises activations, and the
 * subscription's unique `organisationId` means a second activation returns the existing row.
 *
 * Exactly one trial per organisation and per person: if the organisation already had a grant, or
 * any owner (or the activating user) has already received a trial under another account or
 * organisation (same user id, email or phone), the subscription starts as `EXPIRED` with the reason
 * recorded, so the owner goes straight to choosing a paid plan. Nothing is ever charged here.
 */
export async function activatePropertyManagement(organisationId: string, actorUserId: string | null, now: Date = new Date()) {
  const existing = await db.organisationSubscription.findUnique({ where: { organisationId } });
  if (existing) return existing;
  const organisation = await db.organisation.findUnique({
    where: { id: organisationId },
    select: { id: true, defaultCurrencyCode: true, archivedAt: true, marketplaceProfessional: { select: { id: true } }, providerProfile: { select: { id: true } } },
  });
  if (!organisation || organisation.archivedAt) throw managementUnavailable();
  // A Marketplace professional's or service company's backing organisation is a marketplace
  // account; it can never activate property management or be billed for it.
  if (organisation.marketplaceProfessional || organisation.providerProfile) throw managementUnavailable();

  const result = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pm-activation:${organisationId}`}))`;
    const raced = await tx.organisationSubscription.findUnique({ where: { organisationId } });
    if (raced) return { subscription: raced, notificationId: null as string | null };

    const trialPlan = await tx.subscriptionPlan.findUnique({ where: { key: TRIAL_PLAN_KEY } });
    if (!trialPlan) throw new Error("The property-management trial plan has not been seeded.");
    const identities = await trialIdentities(tx, organisationId, actorUserId);
    // Lock the identity hashes too, so two organisations of the same person activating at once
    // cannot both pass the "already used" check.
    for (const hash of [...identities.keys()].sort()) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pm-trial-identity:${hash}`}))`;
    const priorGrant = await tx.managementTrialGrant.findUnique({ where: { organisationId } });
    const usedIdentity = await tx.managementTrialIdentity.findFirst({ where: { identityHash: { in: [...identities.keys()] } }, select: { kind: true } });
    const eligible = !priorGrant && !usedIdentity;

    const trialEndsAt = new Date(now.getTime() + days(PM_BILLING_RULES.trialDays));
    const subscription = await tx.organisationSubscription.create({
      data: eligible
        ? {
          organisationId, planId: trialPlan.id, status: "TRIALING", billingCycle: "MONTHLY", currencyCode: organisation.defaultCurrencyCode,
          billingProviderKey: resolveDefaultBillingProviderKey(), managementActivatedAt: now, trialStartedAt: now, trialEndsAt,
          currentPeriodStart: now, currentPeriodEnd: trialEndsAt,
        }
        : {
          organisationId, planId: trialPlan.id, status: "EXPIRED", billingCycle: "MONTHLY", currencyCode: organisation.defaultCurrencyCode,
          billingProviderKey: resolveDefaultBillingProviderKey(), managementActivatedAt: now, expiredAt: now,
          currentPeriodStart: now, currentPeriodEnd: now,
        },
    });
    const reason = eligible
      ? `Property management activated; ${PM_BILLING_RULES.trialDays}-day free trial started.`
      : `Property management activated; the free trial was already used${usedIdentity ? ` (matched by ${usedIdentity.kind})` : ""}, so a paid plan is required.`;
    await tx.subscriptionStatusHistory.create({ data: { subscriptionId: subscription.id, organisationId, fromStatus: null, toStatus: subscription.status, reason, actorUserId } });
    await tx.auditEvent.create({
      data: { organisationId, actorUserId, action: eligible ? "subscription.trial_started" : "subscription.trial_denied", entityType: "organisation_subscription", entityId: subscription.id, metadata: json({ trialEndsAt: eligible ? trialEndsAt.toISOString() : null, reason }) },
    });
    await tx.domainEvent.create({ data: { organisationId, name: eligible ? "subscription.trial_started" : "subscription.trial_denied", aggregateType: "organisation_subscription", aggregateId: subscription.id, payload: json({ trialEndsAt: eligible ? trialEndsAt.toISOString() : null }) } });

    let notificationId: string | null = null;
    if (eligible) {
      const grant = await tx.managementTrialGrant.create({ data: { organisationId, grantedToUserId: actorUserId, startedAt: now, endsAt: trialEndsAt } });
      await tx.managementTrialIdentity.createMany({ data: [...identities].map(([identityHash, kind]) => ({ grantId: grant.id, kind, identityHash })), skipDuplicates: true });
      notificationId = await notifySubscriptionEvent(tx, organisationId, "SUBSCRIPTION_TRIAL_STARTED", `${subscription.id}:trial_started`);
    } else {
      notificationId = await notifySubscriptionEvent(tx, organisationId, "SUBSCRIPTION_EXPIRED", `${subscription.id}:trial_denied`);
    }
    return { subscription, notificationId };
  });
  if (result.notificationId) await enqueueNotificationDelivery({ id: result.notificationId, organisationId });
  return result.subscription;
}
