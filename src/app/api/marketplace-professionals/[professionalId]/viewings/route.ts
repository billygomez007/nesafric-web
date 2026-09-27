import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { pageOf, viewingListItem } from "@/modules/listings/lead-responses";
import { listMarketplaceProfessionalViewings } from "@/modules/listings/service";
type Context = { params: Promise<{ professionalId: string }> };
export async function GET(request: NextRequest, { params }: Context) {
  try {
    const user = await requireUser();
    const page = await listMarketplaceProfessionalViewings(user.id, (await params).professionalId, Object.fromEntries(request.nextUrl.searchParams));
    return NextResponse.json(pageOf(page, viewingListItem));
  }
  catch (error) { return errorResponse(error); }
}
