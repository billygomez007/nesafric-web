import { NextResponse } from "next/server";
import { leadListItem, pageOf, parseLeadView } from "@/modules/listings/lead-responses";
import { listMarketplaceLeads } from "@/modules/listings/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

export async function GET(request: Request) {
  try {
    const query = Object.fromEntries(new URL(request.url).searchParams);
    const view = parseLeadView(query.view);
    const page = await listMarketplaceLeads((await requireUser()).id, requireOrganisationId(request), query);
    return NextResponse.json(pageOf(page, (lead) => leadListItem(lead, view)));
  } catch (error) {
    return errorResponse(error);
  }
}
