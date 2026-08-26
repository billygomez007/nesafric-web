import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";
import { getLeasePaymentHistory } from "@/modules/payments/service";

export async function GET(request: Request, { params }: { params: Promise<{ leaseId: string }> }) {
  try {
    return NextResponse.json(await getLeasePaymentHistory((await requireUser()).id, requireOrganisationId(request), (await params).leaseId));
  } catch (error) {
    return errorResponse(error);
  }
}
