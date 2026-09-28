import { NextResponse } from "next/server";
import { searchTopAdCandidates } from "@/modules/marketplace/top-ads";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requirePlatformPrincipal } from "@/platform/platform-admin/auth";

/** Listings that are live on the public marketplace right now, matching `?search=`. */
export async function GET(request: Request) {
  try {
    const principal = await requirePlatformPrincipal(await requireUser());
    return NextResponse.json(await searchTopAdCandidates(principal, new URL(request.url).searchParams.get("search") ?? undefined));
  } catch (error) {
    return errorResponse(error);
  }
}
