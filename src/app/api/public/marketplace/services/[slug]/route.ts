import { NextResponse } from "next/server";
import { getPublicMarketplaceProviderBySlug, PUBLIC_MARKETPLACE_RATE_LIMIT } from "@/modules/marketplace/service";
import { errorResponse } from "@/platform/errors";

type Context = { params: Promise<{ slug: string }> };

/** Slug-based alias of `/api/public/marketplace/providers/[providerId]` — matches the
 * `/marketplace/professionals/[slug]` URL convention for the Property Services IA. */
export async function GET(_request: Request, { params }: Context) {
  try {
    return NextResponse.json(
      await getPublicMarketplaceProviderBySlug((await params).slug),
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
