import { NextResponse } from "next/server";
import { listRegions } from "@/modules/geography/catalog";
import { assertGeoRateLimit, geoReadHeaders } from "@/modules/geography/rate-limit";
import { errorResponse } from "@/platform/errors";

export async function GET(request: Request) {
  try {
    assertGeoRateLimit(request, "geo-regions");
    const country = new URL(request.url).searchParams.get("country") ?? "";
    return NextResponse.json({ items: await listRegions(country) }, { headers: geoReadHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}
