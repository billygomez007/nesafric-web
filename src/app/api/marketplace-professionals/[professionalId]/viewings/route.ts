import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { listMarketplaceProfessionalViewings } from "@/modules/listings/service";
type Context = { params: Promise<{ professionalId: string }> };
export async function GET(request: NextRequest, { params }: Context) {
  try { const user = await requireUser(); return NextResponse.json(await listMarketplaceProfessionalViewings(user.id, (await params).professionalId, Object.fromEntries(request.nextUrl.searchParams))); }
  catch (error) { return errorResponse(error); }
}
