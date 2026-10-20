import { NextResponse } from "next/server";
import { z } from "zod";
import { assertGeoRateLimit } from "@/modules/geography/rate-limit";
import { resolveLocation } from "@/modules/geography/resolve";
import { errorResponse } from "@/platform/errors";

/**
 * Suggests places for typed text (and checks a selection). Returns names and ids only; it never
 * echoes coordinates or access notes back, and nothing is saved.
 */
const bodySchema = z.object({
  countryCode: z.string().length(2),
  regionId: z.string().max(80).nullish(),
  districtId: z.string().max(80).nullish(),
  localityId: z.string().max(80).nullish(),
  text: z.object({ region: z.string().max(150).nullish(), district: z.string().max(150).nullish(), city: z.string().max(150).nullish(), locality: z.string().max(150).nullish() }).strict().nullish(),
}).strict();

export async function POST(request: Request) {
  try {
    assertGeoRateLimit(request, "geo-resolve", 60);
    const body = bodySchema.parse(await request.json().catch(() => ({})));
    const result = await resolveLocation(body);
    return NextResponse.json({
      status: result.status, region: result.region, district: result.district, locality: result.locality,
      candidates: result.candidates, issues: result.issues, verification: result.verification,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
