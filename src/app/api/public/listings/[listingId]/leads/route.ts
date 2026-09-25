import { NextResponse } from "next/server";
import { createMarketplaceLead } from "@/modules/listings/service";
import { createMarketplaceLeadSchema, listingIdSchema } from "@/modules/listings/schemas";
import { getOptionalUser } from "@/platform/auth/session";
import { fingerprintOf, readIdempotencyKey, runIdempotent } from "@/platform/security/idempotency";
import { assertPublicWriteAllowed, publicWriteErrorResponse } from "@/platform/security/public-write-limit";

/** Guest (or signed-in) enquiry on a public listing. Rate-limited and idempotent (`Idempotency-Key`). */
export async function POST(request: Request, { params }: { params: Promise<{ listingId: string }> }) {
  try {
    const listingId = listingIdSchema.parse((await params).listingId);
    const userId = (await getOptionalUser())?.id;
    // Validate before charging any rate-limit budget, so correcting a typo doesn't count as abuse.
    const data = createMarketplaceLeadSchema.parse(await request.json().catch(() => null));
    const result = await runIdempotent(
      { scope: `lead:${listingId}`, key: readIdempotencyKey(request.headers), fingerprint: fingerprintOf({ listingId, userId: userId ?? null, data }) },
      async () => {
        await assertPublicWriteAllowed(request.headers, { kind: "enquiry", listingId, contact: data });
        return { status: 201, body: await createMarketplaceLead(listingId, userId, data) };
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
