import { randomUUID } from "node:crypto";
import { db } from "@/platform/database/client";
import { registerUser } from "@/modules/identity/service";
import { reviewListingVerificationForPlatform } from "@/modules/platform-admin/service";

/**
 * Verifies a listing the way production does: as a NesAfric platform reviewer. A marketplace
 * professional cannot verify its own listing, so tests that need a verified marketplace listing
 * use this instead of calling `updateListingVerification` as the business.
 */
export async function verifyListingAsNesAfric(listingId: string, note = "Authority checked.") {
  const user = await registerUser({ displayName: "NesAfric reviewer", email: `reviewer-${randomUUID()}@example.com`, password: "secure-password-123" });
  const principal = await db.platformPrincipal.create({ data: { userId: user.id, role: "SUPER_ADMIN", status: "ACTIVE", createdVia: "MANUAL" } });
  return reviewListingVerificationForPlatform(principal, listingId, { status: "VERIFIED", note });
}
