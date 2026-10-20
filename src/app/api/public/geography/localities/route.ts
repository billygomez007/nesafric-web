import { NextResponse } from "next/server";
import { searchLocalities } from "@/modules/geography/catalog";
import { assertGeoRateLimit, geoReadHeaders } from "@/modules/geography/rate-limit";
import { errorResponse } from "@/platform/errors";

/** Searchable, cursor-paginated localities (lazy-loaded by the selector). */
export async function GET(request: Request) {
  try {
    assertGeoRateLimit(request, "geo-localities");
    return NextResponse.json(await searchLocalities(Object.fromEntries(new URL(request.url).searchParams)), { headers: { ...geoReadHeaders, "Cache-Control": "public, max-age=60, stale-while-revalidate=300" } });
  } catch (error) {
    return errorResponse(error);
  }
}
