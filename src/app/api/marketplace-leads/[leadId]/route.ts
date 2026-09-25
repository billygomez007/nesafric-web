import { NextResponse } from "next/server";
import { leadDetail, parseLeadView } from "@/modules/listings/lead-responses";
import { getMarketplaceLead, updateMarketplaceLead } from "@/modules/listings/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

type Context = { params: Promise<{ leadId: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const lead = await getMarketplaceLead((await requireUser()).id, requireOrganisationId(request), (await params).leadId);
    return NextResponse.json(leadDetail(lead, parseLeadView(new URL(request.url).searchParams.get("view"))));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const lead = await updateMarketplaceLead((await requireUser()).id, requireOrganisationId(request), (await params).leadId, await request.json());
    return NextResponse.json(leadDetail(lead, "full"));
  } catch (error) {
    return errorResponse(error);
  }
}
