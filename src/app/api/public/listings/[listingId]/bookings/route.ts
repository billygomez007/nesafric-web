import { NextResponse } from "next/server";
import { createAccommodationBooking, findBookingForSubmission } from "@/modules/bookings/service";
import { createAccommodationBookingSchema } from "@/modules/bookings/schemas";
import { listingIdSchema } from "@/modules/listings/schemas";
import { getOptionalUser } from "@/platform/auth/session";
import { fingerprintOf, isUniqueViolation, readIdempotencyKey, runIdempotent } from "@/platform/security/idempotency";
import { publicWriteErrorResponse, withPublicWriteReservation } from "@/platform/security/public-write-limit";

/** Bounds how long a request can hold an idempotency claim (see STALE_PENDING_MS). */
export const maxDuration = 30;

/**
 * A guest (or signed-in) booking request for a hotel or short-stay listing. The recipient is the
 * listing's operator, resolved on the server. Rate-limited per IP, contact and listing, and
 * idempotent (`Idempotency-Key`), exactly like property enquiries. The response only describes the
 * request (reference, dates, status): nothing about the operator.
 */
export async function POST(request: Request, { params }: { params: Promise<{ listingId: string }> }) {
  try {
    const listingId = listingIdSchema.parse((await params).listingId);
    const userId = (await getOptionalUser())?.id;
    // Validate before charging any rate-limit budget, so correcting a typo doesn't count as abuse.
    const data = createAccommodationBookingSchema.parse(await request.json().catch(() => null));
    const fingerprint = fingerprintOf({ listingId, userId: userId ?? null, data });
    const result = await runIdempotent(
      { scope: `booking:${listingId}`, key: readIdempotencyKey(request.headers), fingerprint },
      async ({ keyHash }) => {
        const submission = keyHash ? { keyHash, fingerprint } : undefined;
        const existing = submission ? await findBookingForSubmission(listingId, submission) : null;
        if (existing) return { status: 201, body: existing, replayed: true };
        try {
          // Slots are refunded if creation fails (not bookable, dates invalid, listing gone).
          return await withPublicWriteReservation(request.headers, { kind: "booking", listingId, contact: { email: data.email, phone: data.phone } }, async () => ({
            status: 201,
            body: await createAccommodationBooking(listingId, userId, data, { submission }),
          }));
        } catch (error) {
          const winner = submission && isUniqueViolation(error) ? await findBookingForSubmission(listingId, submission) : null;
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
