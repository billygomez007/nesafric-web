import { NextResponse } from "next/server";
import { listGeoCountries } from "@/modules/geography/catalog";
import { assertGeoRateLimit, geoReadHeaders } from "@/modules/geography/rate-limit";
import { errorResponse } from "@/platform/errors";

/** Countries whose geography is configured. Unconfigured countries are never listed. */
export async function GET(request: Request) {
  try {
    assertGeoRateLimit(request, "geo-countries");
    return NextResponse.json({ items: await listGeoCountries() }, { headers: geoReadHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}
