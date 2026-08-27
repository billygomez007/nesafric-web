import { NextResponse } from "next/server";
import { transitionLeaseRenewal } from "@/modules/lifecycle/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

export async function PATCH(request: Request, { params }: { params: Promise<{ leaseId: string }> }) {
  try {
    return NextResponse.json(await transitionLeaseRenewal(
      (await requireUser()).id,
      requireOrganisationId(request),
      (await params).leaseId,
      await request.json(),
    ));
  } catch (error) {
    return errorResponse(error);
  }
}
