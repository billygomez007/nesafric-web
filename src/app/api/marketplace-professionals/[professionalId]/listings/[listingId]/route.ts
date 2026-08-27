import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { getMarketplaceProfessionalListing, updateMarketplaceProfessionalListing } from "@/modules/listings/service";

type Context = { params: Promise<{ professionalId: string; listingId: string }> };
export async function GET(_request: Request, { params }: Context) {
  try { const user = await requireUser(); const p = await params; return NextResponse.json(await getMarketplaceProfessionalListing(user.id, p.professionalId, p.listingId)); }
  catch (error) { return errorResponse(error); }
}
export async function PATCH(request: Request, { params }: Context) {
  try { const user = await requireUser(); const p = await params; return NextResponse.json(await updateMarketplaceProfessionalListing(user.id, p.professionalId, p.listingId, await request.json())); }
  catch (error) { return errorResponse(error); }
}
