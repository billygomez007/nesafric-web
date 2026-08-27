import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse, AppError } from "@/platform/errors";
import { assignMarketplaceLead } from "@/modules/marketplace-professionals/service";

type Context = { params: Promise<{ professionalId: string; leadId: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    const user = await requireUser();
    const { professionalId, leadId } = await params;
    const body = await request.json();
    if (typeof body.representativeMemberId !== "string") throw new AppError("VALIDATION_ERROR", 400, "representativeMemberId is required.");
    return NextResponse.json(await assignMarketplaceLead(user.id, professionalId, leadId, body.representativeMemberId));
  } catch (error) {
    return errorResponse(error);
  }
}
