import { NextResponse } from "next/server";
import { importSavedListings } from "@/modules/saved-listings/service";
import { requireUser } from "@/platform/auth/session";
import { AppError, errorResponse } from "@/platform/errors";

/** Merges a device's saved list (e.g. the mobile app's, on sign-in) into the account. Safe to repeat. */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json().catch(() => {
      throw new AppError("INVALID_JSON", 400, "The request body must be valid JSON.");
    });
    return NextResponse.json(await importSavedListings(user.id, body), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
