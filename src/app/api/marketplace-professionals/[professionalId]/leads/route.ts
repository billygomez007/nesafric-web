import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { listMarketplaceProfessionalLeads } from "@/modules/listings/service";
type Context = { params: Promise<{ professionalId: string }> };
export async function GET(request: NextRequest, { params }: Context) {
  try { const user = await requireUser(); return NextResponse.json(await listMarketplaceProfessionalLeads(user.id, (await params).professionalId, Object.fromEntries(request.nextUrl.searchParams))); }
  catch (error) { return errorResponse(error); }
}
