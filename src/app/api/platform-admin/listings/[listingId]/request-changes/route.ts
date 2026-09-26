import { NextResponse } from "next/server";
import { requestListingChangesForPlatform } from "@/modules/platform-admin/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requirePlatformPrincipal } from "@/platform/platform-admin/auth";

/** Returns a listing in review to its professional as a draft, with the reviewer's note. */
export async function POST(request: Request, { params }: { params: Promise<{ listingId: string }> }) {
  try {
    const principal = await requirePlatformPrincipal(await requireUser());
    const { listingId } = await params;
    return NextResponse.json(await requestListingChangesForPlatform(principal, listingId, await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
}
