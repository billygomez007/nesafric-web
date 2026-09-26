import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { parseLeadView, viewingDetail } from "@/modules/listings/lead-responses";
import { getMarketplaceProfessionalViewing } from "@/modules/listings/service";

type Context = { params: Promise<{ professionalId: string; viewingRequestId: string }> };

/** Read-only: one viewing request on one of this professional's listings (active members only). */
export async function GET(request: Request, { params }: Context) {
  try {
    const user = await requireUser();
    const { professionalId, viewingRequestId } = await params;
    const viewing = await getMarketplaceProfessionalViewing(user.id, professionalId, viewingRequestId);
    return NextResponse.json(viewingDetail(viewing, parseLeadView(new URL(request.url).searchParams.get("view"))));
  } catch (error) {
    return errorResponse(error);
  }
}
