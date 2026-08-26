import { NextResponse } from "next/server";
import { discoverMarketplaceProviders, PUBLIC_MARKETPLACE_RATE_LIMIT } from "@/modules/marketplace/service";
import { errorResponse } from "@/platform/errors";

const publicHeaders = {
  "Cache-Control": "public, max-age=30, stale-while-revalidate=60",
  "X-RateLimit-Policy": `${PUBLIC_MARKETPLACE_RATE_LIMIT.policy};w=${PUBLIC_MARKETPLACE_RATE_LIMIT.windowSeconds};limit=${PUBLIC_MARKETPLACE_RATE_LIMIT.limit}`,
};

export async function GET(request: Request) {
  try {
    const query = Object.fromEntries(new URL(request.url).searchParams);
    return NextResponse.json(await discoverMarketplaceProviders(query), { headers: publicHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}
