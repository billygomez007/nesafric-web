import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { submitMarketplaceProfessionalListingVerification } from "@/modules/listings/service";
type Context = { params: Promise<{ professionalId: string; listingId: string }> };
export async function POST(request: Request, { params }: Context) {
  try { const user = await requireUser(); const p = await params; return NextResponse.json(await submitMarketplaceProfessionalListingVerification(user.id, p.professionalId, p.listingId, await request.json())); }
  catch (error) { return errorResponse(error); }
}
