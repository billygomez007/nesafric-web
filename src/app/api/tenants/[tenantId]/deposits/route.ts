import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";
import { getTenantDepositHistory } from "@/modules/payments/service";

export async function GET(request: Request, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    return NextResponse.json(await getTenantDepositHistory((await requireUser()).id, requireOrganisationId(request), (await params).tenantId));
  } catch (error) {
    return errorResponse(error);
  }
}
