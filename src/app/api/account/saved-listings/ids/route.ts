import { NextResponse } from "next/server";
import { listSavedListingIds } from "@/modules/saved-listings/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";

/** Only the saved listing ids, for showing heart states without loading listings. */
export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json(await listSavedListingIds(user.id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
