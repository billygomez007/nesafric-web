import { NextResponse } from "next/server";
import { decideDepositDeduction, reverseDepositDeduction } from "@/modules/move-out/service";
import { requireUser } from "@/platform/auth/session";
import { AppError, errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

type Context = { params: Promise<{ leaseId: string; deductionId: string }> };

export async function PATCH(request: Request, { params }: Context) {
  try {
    const user = await requireUser();
    const organisationId = requireOrganisationId(request);
    const { leaseId, deductionId } = await params;
    const body = await request.json();
    const { action, ...input } = body;
    switch (action) {
      case "decision":
        return NextResponse.json(await decideDepositDeduction(user.id, organisationId, leaseId, deductionId, input));
      case "reversal":
        return NextResponse.json(await reverseDepositDeduction(user.id, organisationId, leaseId, deductionId, input));
      default:
        throw new AppError("INVALID_DEDUCTION_ACTION", 400, "Choose a valid deduction action.");
    }
  } catch (error) {
    return errorResponse(error);
  }
}
