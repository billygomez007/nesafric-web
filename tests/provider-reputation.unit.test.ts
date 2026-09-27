import { describe, expect, it } from "vitest";
import {
  attributionForReason,
  CANCELLATION_REASON_ATTRIBUTION,
  CANCELLATION_REASONS,
  isProviderCausedCancellation,
  MIN_COMPLETION_RATE_BASIS,
  reputationFromAssignments,
  reputationSql,
} from "@/modules/providers/reputation";
import { providerCancellationReasonSchema, transitionMaintenanceSchema } from "@/modules/maintenance/schemas";
import { updateMarketplaceProfileSchema } from "@/modules/marketplace/schemas";
import { updateProviderSchema } from "@/modules/providers/schemas";

/** The authoritative reputation rule (reference implementation) and cancellation attribution. */

type Status = "PENDING" | "ACCEPTED" | "DECLINED" | "CANCELLED" | "COMPLETED";
type Attribution = "PROVIDER" | "LANDLORD" | "TENANT" | "MUTUAL" | "SYSTEM" | "UNKNOWN";
const accepted = new Date("2026-09-01T00:00:00Z");
const job = (status: Status, attribution: Attribution | null = null, acceptedAt: Date | null = accepted) => ({ status, acceptedAt, cancellationAttribution: attribution });
const completed = (count: number) => Array.from({ length: count }, () => job("COMPLETED"));

describe("completion rate", () => {
  it("5 completed jobs is 100%", () => {
    expect(reputationFromAssignments(completed(5))).toEqual({ completedJobs: 5, concludedJobs: 5, completionRate: 1, providerAttributedCancellations: 0 });
  });

  it("4 completed jobs is below the minimum history, so null", () => {
    expect(MIN_COMPLETION_RATE_BASIS).toBe(5);
    expect(reputationFromAssignments(completed(4)).completionRate).toBeNull();
    expect(reputationFromAssignments(completed(1)).completionRate).toBeNull();
  });

  it("4 completed + 1 provider-caused cancellation is 80%", () => {
    expect(reputationFromAssignments([...completed(4), job("CANCELLED", "PROVIDER")])).toEqual({ completedJobs: 4, concludedJobs: 5, completionRate: 0.8, providerAttributedCancellations: 1 });
  });

  it.each(["LANDLORD", "TENANT", "MUTUAL", "SYSTEM", "UNKNOWN"] as const)("a %s cancellation does not reduce the rate", (attribution) => {
    expect(reputationFromAssignments([...completed(5), job("CANCELLED", attribution)])).toMatchObject({ concludedJobs: 5, completionRate: 1 });
  });

  it("a historical cancellation with no attribution does not reduce the rate", () => {
    expect(reputationFromAssignments([...completed(5), job("CANCELLED", null)])).toMatchObject({ concludedJobs: 5, completionRate: 1 });
  });

  it("a provider-attributed cancellation of an offer never accepted does not count", () => {
    expect(isProviderCausedCancellation(job("CANCELLED", "PROVIDER", null))).toBe(false);
    expect(reputationFromAssignments([...completed(5), job("CANCELLED", "PROVIDER", null)]).completionRate).toBe(1);
  });

  it.each(["PENDING", "ACCEPTED", "DECLINED"] as const)("a %s assignment stays out of the denominator", (status) => {
    expect(reputationFromAssignments([...completed(5), job(status), job(status)])).toMatchObject({ completedJobs: 5, concludedJobs: 5, completionRate: 1 });
  });

  it("keeps the completed-job count exact", () => {
    const mixed = [...completed(7), job("CANCELLED", "PROVIDER"), job("CANCELLED", "LANDLORD"), job("PENDING"), job("DECLINED")];
    expect(reputationFromAssignments(mixed)).toEqual({ completedJobs: 7, concludedJobs: 8, completionRate: 0.875, providerAttributedCancellations: 1 });
  });

  it("uses exactly the same rule in the public SQL", () => {
    const sql = reputationSql.concludedJobs.strings.join("?").replace(/\s+/g, " ");
    expect(sql).toContain(`a."status" = 'COMPLETED' OR (a."status" = 'CANCELLED' AND a."cancellationAttribution" = 'PROVIDER' AND a."acceptedAt" IS NOT NULL)`);
    expect(reputationSql.completedJobs.strings.join("?")).toContain(`a."status" = 'COMPLETED'`);
  });
});

describe("cancellation attribution", () => {
  it("derives responsibility from the reason, never blaming the provider for ambiguous reasons", () => {
    expect(CANCELLATION_REASON_ATTRIBUTION).toEqual({
      PROVIDER_FAILED_TO_ATTEND: "PROVIDER",
      PROVIDER_WITHDREW: "PROVIDER",
      WORK_NO_LONGER_REQUIRED: "LANDLORD",
      CHANGED_PLANS: "LANDLORD",
      FOUND_ANOTHER_PROVIDER: "LANDLORD",
      TENANT_WITHDREW: "TENANT",
      MUTUAL_AGREEMENT: "MUTUAL",
      SCHEDULING_ISSUE: "UNKNOWN",
      OTHER: "UNKNOWN",
    });
    expect(attributionForReason(undefined)).toBe("UNKNOWN");
    expect(attributionForReason(null)).toBe("UNKNOWN");
  });

  it("offers exactly the reasons the API accepts, and no internal SYSTEM choice", () => {
    expect([...providerCancellationReasonSchema.options].sort()).toEqual([...CANCELLATION_REASONS].sort());
    expect(Object.values(CANCELLATION_REASON_ATTRIBUTION)).not.toContain("SYSTEM");
  });

  it("drops any responsibility, actor or provider value a client tries to send", () => {
    const parsed = transitionMaintenanceSchema.parse({
      status: "CANCELLED",
      cancellationReason: "WORK_NO_LONGER_REQUIRED",
      cancellationAttribution: "LANDLORD",
      cancelledByUserId: "someone",
      providerId: "someone-else",
    });
    expect(parsed).toEqual({ status: "CANCELLED", cancellationReason: "WORK_NO_LONGER_REQUIRED" });
  });

  it("accepts a reason only when cancelling, and only a known reason", () => {
    expect(transitionMaintenanceSchema.safeParse({ status: "COMPLETED", cancellationReason: "OTHER" }).success).toBe(false);
    expect(transitionMaintenanceSchema.safeParse({ status: "CANCELLED", cancellationReason: "PROVIDER_IS_BAD" }).success).toBe(false);
    expect(transitionMaintenanceSchema.safeParse({ status: "CANCELLED" }).success).toBe(true);
  });

  it("gives providers no field through which to set their own reputation", () => {
    for (const field of ["completionRate", "completionRateBasis", "completedJobs", "concludedJobs", "cancellationAttribution"]) {
      expect(updateMarketplaceProfileSchema.safeParse({ [field]: 1 }).success).toBe(false);
      expect(updateProviderSchema.safeParse({ [field]: 1 }).data ?? {}).not.toHaveProperty(field);
    }
  });
});
