import { NextResponse } from "next/server";
import { getFinalTenantStatement } from "@/modules/move-out/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

type Context = { params: Promise<{ leaseId: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    return NextResponse.json(await getFinalTenantStatement((await requireUser()).id, requireOrganisationId(request), (await params).leaseId));
  } catch (error) {
    return errorResponse(error);
  }
}
