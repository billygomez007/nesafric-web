import { NextResponse } from "next/server";
import { completeMoveIn, scheduleMoveIn, updateMoveInChecklist } from "@/modules/lease-execution/service";
import { requireUser } from "@/platform/auth/session";
import { AppError, errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

type Context = { params: Promise<{ leaseId: string }> };
export async function POST(request: Request, { params }: Context) {
  try {
    return NextResponse.json(await scheduleMoveIn((await requireUser()).id, requireOrganisationId(request), (await params).leaseId, await request.json()), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function PATCH(request: Request, { params }: Context) {
  try {
    const body = await request.json();
    const user = await requireUser();
    const organisationId = requireOrganisationId(request);
    const leaseId = (await params).leaseId;
    const { action, ...input } = body;
    if (action === "checklist") return NextResponse.json(await updateMoveInChecklist(user.id, organisationId, leaseId, input));
    if (action === "complete") return NextResponse.json(await completeMoveIn(user.id, organisationId, leaseId, input));
    throw new AppError("INVALID_MOVE_IN_ACTION", 400, "Choose a valid move-in action.");
  } catch (error) {
    return errorResponse(error);
  }
}
