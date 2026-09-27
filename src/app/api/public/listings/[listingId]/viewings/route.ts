import { NextResponse } from "next/server";
import { createViewingRequest, findViewingForSubmission } from "@/modules/listings/service";
import { createViewingRequestSchema, listingIdSchema } from "@/modules/listings/schemas";
import { getOptionalUser } from "@/platform/auth/session";
import { fingerprintOf, isUniqueViolation, readIdempotencyKey, runIdempotent } from "@/platform/security/idempotency";
import { publicWriteErrorResponse, withPublicWriteReservation } from "@/platform/security/public-write-limit";

/** Bounds how long a request can hold an idempotency claim (see STALE_PENDING_MS). */
export const maxDuration = 30;

/** Viewing request for an existing enquiry (lead). Rate-limited per IP, lead and listing; idempotent. */
export async function POST(request: Request, { params }: { params: Promise<{ listingId: string }> }) {
  try {
    const listingId = listingIdSchema.parse((await params).listingId);
    const userId = (await getOptionalUser())?.id;
    const data = createViewingRequestSchema.parse(await request.json().catch(() => null));
    const fingerprint = fingerprintOf({ listingId, userId: userId ?? null, data });
    const result = await runIdempotent(
      { scope: `viewing:${listingId}`, key: readIdempotencyKey(request.headers), fingerprint },
      async ({ keyHash }) => {
        const submission = keyHash ? { keyHash, fingerprint } : undefined;
        const existing = submission ? await findViewingForSubmission(listingId, submission) : null;
        if (existing) return { status: 201, body: existing, replayed: true };
        try {
          return await withPublicWriteReservation(request.headers, { kind: "viewing", listingId, leadId: data.leadId }, async () => ({
            status: 201,
            body: await createViewingRequest(listingId, userId, data, { submission }),
          }));
        } catch (error) {
          const winner = submission && isUniqueViolation(error) ? await findViewingForSubmission(listingId, submission) : null;
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
