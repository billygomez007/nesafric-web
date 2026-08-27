import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { getMarketplaceProfessionalLead, updateMarketplaceProfessionalLead } from "@/modules/listings/service";

type Context = { params: Promise<{ professionalId: string; leadId: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const user = await requireUser();
    const { professionalId, leadId } = await params;
    return NextResponse.json(await getMarketplaceProfessionalLead(user.id, professionalId, leadId));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const user = await requireUser();
    const { professionalId, leadId } = await params;
    return NextResponse.json(await updateMarketplaceProfessionalLead(user.id, professionalId, leadId, await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
}
