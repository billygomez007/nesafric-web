import { NextResponse } from "next/server";
import { createTopAd, listTopAdsForPlatform } from "@/modules/marketplace/top-ads";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requirePlatformPrincipal } from "@/platform/platform-admin/auth";

export async function GET() {
  try {
    const principal = await requirePlatformPrincipal(await requireUser());
    return NextResponse.json(await listTopAdsForPlatform(principal));
  } catch (error) {
    return errorResponse(error);
  }
}

/** `{ listingId, isActive?, startsAt?, endsAt? }` — the listing must be live on the marketplace. */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const principal = await requirePlatformPrincipal(user);
    return NextResponse.json(await createTopAd(principal, user.id, await request.json()), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
