import { NextResponse } from "next/server";
import { getPublicMarketplaceProvider, PUBLIC_MARKETPLACE_RATE_LIMIT } from "@/modules/marketplace/service";
import { errorResponse } from "@/platform/errors";

type Context = { params: Promise<{ providerId: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    return NextResponse.json(
      await getPublicMarketplaceProvider((await params).providerId),
      {
        headers: {
          "Cache-Control": "public, max-age=30, stale-while-revalidate=60",
          "X-RateLimit-Policy": `${PUBLIC_MARKETPLACE_RATE_LIMIT.policy};w=${PUBLIC_MARKETPLACE_RATE_LIMIT.windowSeconds};limit=${PUBLIC_MARKETPLACE_RATE_LIMIT.limit}`,
        },
      },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
