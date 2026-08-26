import { NextResponse } from "next/server";
import { getPublicListing, PUBLIC_LISTING_RATE_LIMIT } from "@/modules/listings/service";
import { errorResponse } from "@/platform/errors";

export async function GET(_request: Request, { params }: { params: Promise<{ listingId: string }> }) {
  try {
    return NextResponse.json(await getPublicListing((await params).listingId), {
      headers: {
        "Cache-Control": "public, max-age=30, stale-while-revalidate=60",
        "X-RateLimit-Policy": `${PUBLIC_LISTING_RATE_LIMIT.policy};w=${PUBLIC_LISTING_RATE_LIMIT.windowSeconds};limit=${PUBLIC_LISTING_RATE_LIMIT.limit}`,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
