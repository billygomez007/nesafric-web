import { NextResponse } from "next/server";
import { getMarketplaceLead, updateMarketplaceLead } from "@/modules/listings/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

type Context = { params: Promise<{ leadId: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    return NextResponse.json(await getMarketplaceLead(
      (await requireUser()).id,
      requireOrganisationId(request),
      (await params).leadId,
    ));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    return NextResponse.json(await updateMarketplaceLead(
      (await requireUser()).id,
      requireOrganisationId(request),
      (await params).leadId,
      await request.json(),
    ));
  } catch (error) {
    return errorResponse(error);
  }
}
