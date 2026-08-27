import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { createMarketplaceNativeListing, listMarketplaceProfessionalListings } from "@/modules/listings/service";

type Context = { params: Promise<{ professionalId: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const user = await requireUser();
    const query = Object.fromEntries(new URL(request.url).searchParams);
    return NextResponse.json(await listMarketplaceProfessionalListings(user.id, (await params).professionalId, query));
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, { params }: Context) {
  try { const user = await requireUser(); return NextResponse.json(await createMarketplaceNativeListing(user.id, (await params).professionalId, await request.json()), { status: 201 }); }
  catch (error) { return errorResponse(error); }
}
