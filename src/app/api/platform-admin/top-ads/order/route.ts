import { NextResponse } from "next/server";
import { reorderTopAds } from "@/modules/marketplace/top-ads";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requirePlatformPrincipal } from "@/platform/platform-admin/auth";

/** Replaces the whole Top Ads order in one transaction: `{ "ids": ["<top ad id>", ...] }`. */
export async function PUT(request: Request) {
  try {
    const user = await requireUser();
    const principal = await requirePlatformPrincipal(user);
    return NextResponse.json(await reorderTopAds(principal, user.id, await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
}
