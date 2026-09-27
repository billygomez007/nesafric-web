import {
  Prisma,
  type ProviderAssignmentStatus,
  type ProviderCancellationAttribution,
  type ProviderCancellationReason,
} from "@/platform/database/generated/client";
import { db } from "@/platform/database/client";

/**
 * The single definition of a provider's work reputation. Every surface — public marketplace
 * discovery/profile (SQL, for ranking-query performance), the provider's own dashboard and a
 * landlord's directory view (Prisma counts) — derives its figures from the rules in this file,
 * and tests hold the SQL and Prisma paths to the same answer.
 *
 *   completedJobs  = assignments with status COMPLETED
 *   concludedJobs  = completedJobs + provider-caused cancellations
 *   completionRate = completedJobs / concludedJobs, or null when concludedJobs < 5
 *
 * A provider-caused cancellation is an assignment that is CANCELLED, whose responsibility
 * (`cancellationAttribution`) is PROVIDER, and that the provider had ACCEPTED (`acceptedAt` set):
 * an offer the provider never took on is not a job they abandoned.
 *
 * Never in the denominator: PENDING, ACCEPTED (open / not yet due), DECLINED (turned down before
 * starting), and cancellations attributed to the LANDLORD, the TENANT, both parties (MUTUAL), the
 * platform (SYSTEM) or nobody known (UNKNOWN — every cancellation recorded before attribution
 * existed). With fewer than 5 concluded jobs the rate is null: too little history to publish.
 */
export const MIN_COMPLETION_RATE_BASIS = 5;

/** Reason → responsibility. The client sends only a reason; the server derives who is responsible. */
export const CANCELLATION_REASON_ATTRIBUTION: Record<ProviderCancellationReason, ProviderCancellationAttribution> = {
  PROVIDER_FAILED_TO_ATTEND: "PROVIDER",
  PROVIDER_WITHDREW: "PROVIDER",
  WORK_NO_LONGER_REQUIRED: "LANDLORD",
  CHANGED_PLANS: "LANDLORD",
  FOUND_ANOTHER_PROVIDER: "LANDLORD",
  TENANT_WITHDREW: "TENANT",
  MUTUAL_AGREEMENT: "MUTUAL",
  // Ambiguous or unstated reasons never blame the provider.
  SCHEDULING_ISSUE: "UNKNOWN",
  OTHER: "UNKNOWN",
};

export const CANCELLATION_REASONS = Object.keys(CANCELLATION_REASON_ATTRIBUTION) as ProviderCancellationReason[];

export function attributionForReason(reason: ProviderCancellationReason | null | undefined): ProviderCancellationAttribution {
  return reason ? CANCELLATION_REASON_ATTRIBUTION[reason] : "UNKNOWN";
}

export function completionRate(completed: number, basis: number) {
  if (basis < MIN_COMPLETION_RATE_BASIS || completed > basis) return null;
  return Math.round((completed / basis) * 1000) / 1000;
}

type Outcome = { status: ProviderAssignmentStatus; acceptedAt: Date | null; cancellationAttribution: ProviderCancellationAttribution | null };

/** The rule above, for one assignment: does it count against the provider? */
export function isProviderCausedCancellation(assignment: Outcome) {
  return assignment.status === "CANCELLED" && assignment.cancellationAttribution === "PROVIDER" && assignment.acceptedAt !== null;
}

/** The rule above over a list of assignments (reference implementation used by tests). */
export function reputationFromAssignments(assignments: Outcome[]) {
  const completedJobs = assignments.filter(({ status }) => status === "COMPLETED").length;
  const providerAttributedCancellations = assignments.filter(isProviderCausedCancellation).length;
  const concludedJobs = completedJobs + providerAttributedCancellations;
  return { completedJobs, concludedJobs, completionRate: completionRate(completedJobs, concludedJobs), providerAttributedCancellations };
}

/** The same rule as SQL for a provider row aliased `p` (public discovery / ranking query). */
export const reputationSql = {
  completedJobs: Prisma.sql`(SELECT count(*) FROM "ProviderAssignment" a WHERE a."providerId" = p."id" AND a."status" = 'COMPLETED')`,
  concludedJobs: Prisma.sql`(SELECT count(*) FROM "ProviderAssignment" a WHERE a."providerId" = p."id"
    AND (a."status" = 'COMPLETED'
      OR (a."status" = 'CANCELLED' AND a."cancellationAttribution" = 'PROVIDER' AND a."acceptedAt" IS NOT NULL)))`,
};

const providerCausedWhere = { status: "CANCELLED", cancellationAttribution: "PROVIDER", acceptedAt: { not: null } } satisfies Prisma.ProviderAssignmentWhereInput;

/**
 * Reputation for the provider's own dashboard or a landlord's directory view. `landlordOrganisationId`
 * narrows every figure to that landlord's work with the provider (their private relationship);
 * without it the figures are the provider's whole NesAfric record — the same numbers the public
 * marketplace shows.
 */
export async function getProviderReputation(providerId: string, scope: { landlordOrganisationId?: string } = {}) {
  const where = { providerId, ...(scope.landlordOrganisationId ? { landlordOrganisationId: scope.landlordOrganisationId } : {}) };
  const [completedJobs, providerAttributedCancellations, cancelledJobs, completedByLandlord, ratings] = await Promise.all([
    db.providerAssignment.count({ where: { ...where, status: "COMPLETED" } }),
    db.providerAssignment.count({ where: { ...where, ...providerCausedWhere } }),
    db.providerAssignment.count({ where: { ...where, status: "CANCELLED" } }),
    db.providerAssignment.groupBy({ by: ["landlordOrganisationId"], where: { ...where, status: "COMPLETED" }, _count: { _all: true } }),
    db.providerRating.aggregate({ where, _count: { _all: true }, _avg: { score: true } }),
  ]);
  const concludedJobs = completedJobs + providerAttributedCancellations;
  return {
    completedJobs,
    concludedJobs,
    completionRate: completionRate(completedJobs, concludedJobs),
    cancelledJobs,
    providerAttributedCancellations,
    // Landlords who have had two or more jobs completed by this provider.
    repeatCustomers: completedByLandlord.filter(({ _count }) => _count._all >= 2).length,
    ratingAverage: ratings._avg.score,
    ratingCount: ratings._count._all,
  };
}
