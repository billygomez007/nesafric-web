import { NextResponse } from "next/server";
import { createViewingRequest } from "@/modules/listings/service";
import { createViewingRequestSchema, listingIdSchema } from "@/modules/listings/schemas";
import { getOptionalUser } from "@/platform/auth/session";
import { fingerprintOf, readIdempotencyKey, runIdempotent } from "@/platform/security/idempotency";
import { assertPublicWriteAllowed, publicWriteErrorResponse } from "@/platform/security/public-write-limit";

/** Viewing request for an existing enquiry (lead). Rate-limited per IP, lead and listing; idempotent. */
export async function POST(request: Request, { params }: { params: Promise<{ listingId: string }> }) {
  try {
    const listingId = listingIdSchema.parse((await params).listingId);
    const userId = (await getOptionalUser())?.id;
    const data = createViewingRequestSchema.parse(await request.json().catch(() => null));
    const result = await runIdempotent(
      { scope: `viewing:${listingId}`, key: readIdempotencyKey(request.headers), fingerprint: fingerprintOf({ listingId, userId: userId ?? null, data }) },
      async () => {
        await assertPublicWriteAllowed(request.headers, { kind: "viewing", listingId, leadId: data.leadId });
        return { status: 201, body: await createViewingRequest(listingId, userId, data) };
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
