import { NextResponse } from "next/server";
import { listSavedListings } from "@/modules/saved-listings/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";

/** The signed-in user's saved listings, newest first, re-checked against the public marketplace. */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const query = Object.fromEntries(new URL(request.url).searchParams);
    return NextResponse.json(await listSavedListings(user.id, query), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
