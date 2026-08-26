import { NextResponse } from "next/server";
import {
  addTurnoverTask,
  acknowledgeMoveOutInspection,
  approveDepositSettlement,
  closeDepositSettlement,
  closeLeaseAfterMoveOut,
  createDepositDeduction,
  createMoveOutInspection,
  createNoticeToVacate,
  getMoveOut,
  recordDepositRefund,
  recordKeyReturn,
  scheduleMoveOut,
  transitionNoticeToVacate,
  transitionVacancyTurnover,
  updateTurnoverTask,
} from "@/modules/move-out/service";
import { requireUser } from "@/platform/auth/session";
import { AppError, errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

type Context = { params: Promise<{ leaseId: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    return NextResponse.json(await getMoveOut((await requireUser()).id, requireOrganisationId(request), (await params).leaseId));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const user = await requireUser();
    const organisationId = requireOrganisationId(request);
    const leaseId = (await params).leaseId;
    const body = await request.json();
    const { action, ...input } = body;
    switch (action) {
      case "notice.create":
        return NextResponse.json(await createNoticeToVacate(user.id, organisationId, leaseId, input), { status: 201 });
      case "schedule":
        return NextResponse.json(await scheduleMoveOut(user.id, organisationId, leaseId, input));
      case "inspection.create":
        return NextResponse.json(await createMoveOutInspection(user.id, organisationId, leaseId, input), { status: 201 });
      case "inspection.acknowledge":
        return NextResponse.json(await acknowledgeMoveOutInspection(user.id, organisationId, leaseId, input.inspectionId, { acknowledged: true }));
      case "key-return.record":
        return NextResponse.json(await recordKeyReturn(user.id, organisationId, leaseId, input));
      case "deduction.create":
        return NextResponse.json(await createDepositDeduction(user.id, organisationId, leaseId, input), { status: 201 });
      case "settlement.approve":
        return NextResponse.json(await approveDepositSettlement(user.id, organisationId, leaseId, input));
      case "settlement.refund":
        return NextResponse.json(await recordDepositRefund(user.id, organisationId, leaseId, input));
      case "settlement.close":
        return NextResponse.json(await closeDepositSettlement(user.id, organisationId, leaseId));
      case "lease.close":
        return NextResponse.json(await closeLeaseAfterMoveOut(user.id, organisationId, leaseId, input));
      case "turnover.task.create":
        return NextResponse.json(await addTurnoverTask(user.id, organisationId, leaseId, input), { status: 201 });
      default:
        throw new AppError("INVALID_MOVE_OUT_ACTION", 400, "Choose a valid move-out action.");
    }
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const user = await requireUser();
    const organisationId = requireOrganisationId(request);
    const leaseId = (await params).leaseId;
    const body = await request.json();
    const { action, ...input } = body;
    switch (action) {
      case "notice.transition":
        return NextResponse.json(await transitionNoticeToVacate(user.id, organisationId, leaseId, input));
      case "turnover.task.update":
        return NextResponse.json(await updateTurnoverTask(user.id, organisationId, leaseId, input));
      case "turnover.transition":
        return NextResponse.json(await transitionVacancyTurnover(user.id, organisationId, leaseId, input));
      default:
        throw new AppError("INVALID_MOVE_OUT_ACTION", 400, "Choose a valid move-out action.");
    }
  } catch (error) {
    return errorResponse(error);
  }
}
