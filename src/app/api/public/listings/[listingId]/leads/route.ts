import { NextResponse } from "next/server";
import { createMarketplaceLead, PUBLIC_LISTING_WRITE_RATE_LIMIT } from "@/modules/listings/service";
import { getOptionalUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";

export async function POST(request: Request, { params }: { params: Promise<{ listingId: string }> }) {
  try {
    return NextResponse.json(await createMarketplaceLead(
      (await params).listingId,
      (await getOptionalUser())?.id,
      await request.json(),
    ), {
      status: 201,
      headers: {
        "Cache-Control": "no-store",
        "X-RateLimit-Policy": `${PUBLIC_LISTING_WRITE_RATE_LIMIT.policy};w=${PUBLIC_LISTING_WRITE_RATE_LIMIT.windowSeconds};limit=${PUBLIC_LISTING_WRITE_RATE_LIMIT.limit}`,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
