import { NextResponse } from "next/server";
import { listSavedProviders } from "@/modules/marketplace/saved-providers";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";

/** The signed-in user's saved service providers, newest first, with public provider cards. */
export async function GET() {
  try {
    return NextResponse.json(await listSavedProviders((await requireUser()).id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
