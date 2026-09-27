import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { leadDetail, parseLeadView } from "@/modules/listings/lead-responses";
import { getMarketplaceProfessionalLead, updateMarketplaceProfessionalLead } from "@/modules/listings/service";

type Context = { params: Promise<{ professionalId: string; leadId: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const user = await requireUser();
    const { professionalId, leadId } = await params;
    const lead = await getMarketplaceProfessionalLead(user.id, professionalId, leadId);
    return NextResponse.json(leadDetail(lead, parseLeadView(new URL(request.url).searchParams.get("view"))));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const user = await requireUser();
    const { professionalId, leadId } = await params;
    return NextResponse.json(leadDetail(await updateMarketplaceProfessionalLead(user.id, professionalId, leadId, await request.json()), "full"));
  } catch (error) {
    return errorResponse(error);
  }
}
