import { NextResponse } from "next/server";
import { errorResponse } from "@/platform/errors";
import { getPublicBanner, getPublicBanners } from "@/modules/campaigns/service";

/** Public banner projection (item 18/19/24) — no auth required. A `limit` query param switches
 * this from the single best-match banner to a `{ banners: [...] }` list for a carousel; omitting
 * it preserves the original single-`{ banner }` response shape exactly, so `MarketplaceBanner`
 * needs no changes. */
export async function GET(request: Request) {
  try {
    const query = Object.fromEntries(new URL(request.url).searchParams);
    if ("limit" in query) return NextResponse.json({ banners: await getPublicBanners(query) });
    return NextResponse.json({ banner: await getPublicBanner(query) });
  } catch (error) {
    return errorResponse(error);
  }
}
