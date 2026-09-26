import { describe, expect, it, vi } from "vitest";

/**
 * The composite review operations (submit, verify & publish, request changes, reject) must run in
 * one transaction with an explicit budget — Prisma's 5 s default expired in Preview staging when a
 * rejected listing was resubmitted (P2028), leaving the professional unable to resubmit.
 */

const calls: unknown[] = [];
vi.mock("@/platform/database/client", () => ({
  db: { $transaction: vi.fn(async (_fn: unknown, options: unknown) => { calls.push(options); return null; }) },
}));
vi.mock("@/modules/marketplace-professionals/permissions", () => ({
  requireMarketplaceMember: vi.fn(async () => undefined),
  requireMarketplaceRole: vi.fn(async () => undefined),
}));

const { REVIEW_TRANSACTION_OPTIONS, submitMarketplaceListingForReview } = await import("@/modules/listings/service");
const { verifyAndPublishListingForPlatform, requestListingChangesForPlatform, rejectListingForPlatform } = await import("@/modules/platform-admin/service");

const PRO = "11111111-1111-4111-8111-111111111111";
const LISTING = "22222222-2222-4222-8222-222222222222";
const principal = { id: "p", userId: "u", role: "SUPER_ADMIN", status: "ACTIVE" } as never;
const decision = { expectedUpdatedAt: "2026-09-25T10:00:00.000Z", note: "Please add the plot size." };

describe("review transaction budget", () => {
  it("gives every composite review operation an explicit transaction timeout above Prisma's 5 s default", async () => {
    await submitMarketplaceListingForReview("u", PRO, LISTING, {});
    await verifyAndPublishListingForPlatform(principal, LISTING, decision);
    await requestListingChangesForPlatform(principal, LISTING, decision);
    await rejectListingForPlatform(principal, LISTING, decision);
    expect(calls).toEqual([REVIEW_TRANSACTION_OPTIONS, REVIEW_TRANSACTION_OPTIONS, REVIEW_TRANSACTION_OPTIONS, REVIEW_TRANSACTION_OPTIONS]);
    expect(REVIEW_TRANSACTION_OPTIONS.timeout).toBeGreaterThan(5_000);
  });
});
