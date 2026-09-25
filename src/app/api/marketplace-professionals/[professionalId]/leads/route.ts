import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { leadListItem, pageOf, parseLeadView } from "@/modules/listings/lead-responses";
import { listMarketplaceProfessionalLeads } from "@/modules/listings/service";
type Context = { params: Promise<{ professionalId: string }> };
export async function GET(request: NextRequest, { params }: Context) {
  try {
    const user = await requireUser();
    const query = Object.fromEntries(request.nextUrl.searchParams);
    const view = parseLeadView(query.view);
    const page = await listMarketplaceProfessionalLeads(user.id, (await params).professionalId, query);
    return NextResponse.json(pageOf(page, (lead) => leadListItem(lead, view)));
  }
  catch (error) { return errorResponse(error); }
}
