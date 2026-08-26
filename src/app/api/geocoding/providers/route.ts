import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { listAvailableGeocodingProviders } from "@/modules/geocoding/service";

/** Lists registered geocoding adapters and whether each is configured, without exposing secrets. */
export async function GET() {
  try {
    await requireUser();
    return NextResponse.json(listAvailableGeocodingProviders());
  } catch (error) {
    return errorResponse(error);
  }
}
