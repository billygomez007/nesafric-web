import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";
import { createSecurityDeposit, listSecurityDeposits } from "@/modules/payments/service";

export async function GET(request: Request) {
  try {
    const leaseId = new URL(request.url).searchParams.get("leaseId") ?? undefined;
    return NextResponse.json(await listSecurityDeposits((await requireUser()).id, requireOrganisationId(request), leaseId));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    return NextResponse.json(await createSecurityDeposit((await requireUser()).id, requireOrganisationId(request), await request.json()), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
