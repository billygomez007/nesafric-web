import { NextResponse } from "next/server";
import { listDistricts } from "@/modules/geography/catalog";
import { assertGeoRateLimit, geoReadHeaders } from "@/modules/geography/rate-limit";
import { errorResponse } from "@/platform/errors";

export async function GET(request: Request, { params }: { params: Promise<{ regionId: string }> }) {
  try {
    assertGeoRateLimit(request, "geo-districts");
    return NextResponse.json({ items: await listDistricts((await params).regionId) }, { headers: geoReadHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}
