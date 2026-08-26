import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";
import { getSecurityDeposit } from "@/modules/payments/service";

export async function GET(request: Request, { params }: { params: Promise<{ depositId: string }> }) {
  try {
    return NextResponse.json(await getSecurityDeposit((await requireUser()).id, requireOrganisationId(request), (await params).depositId));
  } catch (error) {
    return errorResponse(error);
  }
}
