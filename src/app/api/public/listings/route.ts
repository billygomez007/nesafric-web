import { NextResponse } from "next/server";
import { PUBLIC_LISTING_RATE_LIMIT, searchPublicListings } from "@/modules/listings/service";
import { errorResponse } from "@/platform/errors";

const headers = {
  "Cache-Control": "public, max-age=30, stale-while-revalidate=60",
  "X-RateLimit-Policy": `${PUBLIC_LISTING_RATE_LIMIT.policy};w=${PUBLIC_LISTING_RATE_LIMIT.windowSeconds};limit=${PUBLIC_LISTING_RATE_LIMIT.limit}`,
};

export async function GET(request: Request) {
  try {
    return NextResponse.json(
      await searchPublicListings(Object.fromEntries(new URL(request.url).searchParams)),
      { headers },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
