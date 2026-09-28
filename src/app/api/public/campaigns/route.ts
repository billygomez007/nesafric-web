import { NextResponse } from "next/server";
import { errorResponse } from "@/platform/errors";
import { getPublicBanner, getPublicBanners } from "@/modules/campaigns/service";
import { getPlacementRotationSeconds } from "@/modules/campaigns/rotation";

/** Public banner projection (item 18/19/24) — no auth required. A `limit` query param switches
 * this from the single best-match banner to a `{ banners: [...] }` list for a carousel; omitting
 * it preserves the original single-`{ banner }` response shape exactly, so `MarketplaceBanner`
 * needs no changes. The list shape also carries the placement's `rotationSeconds` (5, 8 or 10),
 * so the website and the native app rotate the same campaigns at the pace Super Admin chose. */
export async function GET(request: Request) {
  try {
    const query = Object.fromEntries(new URL(request.url).searchParams);
    // Never cached: publishing, pausing or ending a campaign must show on the next request.
    const headers = { "cache-control": "no-store" };
    if ("limit" in query) {
      const banners = await getPublicBanners(query);
      const rotationSeconds = await getPlacementRotationSeconds(query.placement as Parameters<typeof getPlacementRotationSeconds>[0]);
      return NextResponse.json({ banners, rotationSeconds }, { headers });
    }
    return NextResponse.json({ banner: await getPublicBanner(query) }, { headers });
  } catch (error) {
    return errorResponse(error);
  }
}
