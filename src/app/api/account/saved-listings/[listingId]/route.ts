import { NextResponse } from "next/server";
import { removeSavedListing, saveListing } from "@/modules/saved-listings/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";

type Context = { params: Promise<{ listingId: string }> };

/** Saves a public listing. Idempotent: 201 when newly saved, 200 when it already was. */
export async function PUT(_request: Request, { params }: Context) {
  try {
    const user = await requireUser();
    const saved = await saveListing(user.id, (await params).listingId);
    return NextResponse.json(saved, { status: saved.created ? 201 : 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Removes a saved listing. Idempotent: 204 whether or not it was saved. */
export async function DELETE(_request: Request, { params }: Context) {
  try {
    const user = await requireUser();
    await removeSavedListing(user.id, (await params).listingId);
    return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
