import { NextResponse } from "next/server";
import { createViewingRequest } from "@/modules/listings/service";
import { createViewingRequestSchema, listingIdSchema } from "@/modules/listings/schemas";
import { getOptionalUser } from "@/platform/auth/session";
import { fingerprintOf, readIdempotencyKey, runIdempotent } from "@/platform/security/idempotency";
import { publicWriteErrorResponse, withPublicWriteReservation } from "@/platform/security/public-write-limit";

/** Viewing request for an existing enquiry (lead). Rate-limited per IP, lead and listing; idempotent. */
/** Bounds how long a request can hold an idempotency claim (see STALE_PENDING_MS). */
export const maxDuration = 30;

export async function POST(request: Request, { params }: { params: Promise<{ listingId: string }> }) {
  try {
    const listingId = listingIdSchema.parse((await params).listingId);
    const userId = (await getOptionalUser())?.id;
    const data = createViewingRequestSchema.parse(await request.json().catch(() => null));
    const result = await runIdempotent(
      { scope: `viewing:${listingId}`, key: readIdempotencyKey(request.headers), fingerprint: fingerprintOf({ listingId, userId: userId ?? null, data }) },
      // Slots are refunded if creation fails (e.g. listing no longer available), so failures cost nothing.
      () => withPublicWriteReservation(request.headers, { kind: "viewing", listingId, leadId: data.leadId }, async () => ({ status: 201, body: await createViewingRequest(listingId, userId, data) })),
    );
    return NextResponse.json(result.body, {
      status: result.status,
      headers: { "Cache-Control": "no-store", ...(result.replayed ? { "Idempotent-Replayed": "true" } : {}) },
    });
  } catch (error) {
    return publicWriteErrorResponse(error);
  }
}
