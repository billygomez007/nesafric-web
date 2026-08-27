import { NextResponse } from "next/server";
import { errorResponse } from "@/platform/errors";
import { getPublicBanner } from "@/modules/campaigns/service";

/** Public banner projection (item 18/19/24) — no auth required. */
export async function GET(request: Request) {
  try {
    const query = Object.fromEntries(new URL(request.url).searchParams);
    return NextResponse.json({ banner: await getPublicBanner(query) });
  } catch (error) {
    return errorResponse(error);
  }
}
