import { NextResponse } from "next/server";
import { createMarketplaceLead, findLeadForSubmission } from "@/modules/listings/service";
import { createMarketplaceLeadSchema, listingIdSchema } from "@/modules/listings/schemas";
import { getOptionalUser } from "@/platform/auth/session";
import { fingerprintOf, isUniqueViolation, readIdempotencyKey, runIdempotent } from "@/platform/security/idempotency";
import { publicWriteErrorResponse, withPublicWriteReservation } from "@/platform/security/public-write-limit";

/** Bounds how long a request can hold an idempotency claim (see STALE_PENDING_MS). */
export const maxDuration = 30;

/** Guest (or signed-in) enquiry on a public listing. Rate-limited and idempotent (`Idempotency-Key`). */
export async function POST(request: Request, { params }: { params: Promise<{ listingId: string }> }) {
  try {
    const listingId = listingIdSchema.parse((await params).listingId);
    const userId = (await getOptionalUser())?.id;
    // Validate before charging any rate-limit budget, so correcting a typo doesn't count as abuse.
    const data = createMarketplaceLeadSchema.parse(await request.json().catch(() => null));
    const fingerprint = fingerprintOf({ listingId, userId: userId ?? null, data });
    const result = await runIdempotent(
      { scope: `lead:${listingId}`, key: readIdempotencyKey(request.headers), fingerprint },
      async ({ keyHash }) => {
        const submission = keyHash ? { keyHash, fingerprint } : undefined;
        // A previous attempt of this exact submission may already have created the lead (e.g. its
        // result couldn't be stored): return that lead — no new lead, notification or quota charge.
        const existing = submission ? await findLeadForSubmission(listingId, submission) : null;
        if (existing) return { status: 201, body: existing, replayed: true };
        try {
          // Slots are refunded if creation fails (e.g. listing no longer available).
          return await withPublicWriteReservation(request.headers, { kind: "enquiry", listingId, contact: data }, async () => ({
            status: 201,
            body: await createMarketplaceLead(listingId, userId, data, { submission }),
          }));
        } catch (error) {
          // A concurrent retry bound this submission first; its transaction owns the lead and the
          // notification, ours rolled back. Reconcile with the winner.
          const winner = submission && isUniqueViolation(error) ? await findLeadForSubmission(listingId, submission) : null;
          if (winner) return { status: 201, body: winner, replayed: true };
          throw error;
        }
      },
    );
    return NextResponse.json(result.body, {
      status: result.status,
      headers: { "Cache-Control": "no-store", ...(result.replayed ? { "Idempotent-Replayed": "true" } : {}) },
    });
  } catch (error) {
    return publicWriteErrorResponse(error);
  }
}
