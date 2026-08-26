import { NextResponse } from "next/server";
import { activateExecutedLease, getActivationReadiness } from "@/modules/lease-execution/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

type Context = { params: Promise<{ leaseId: string }> };
export async function GET(request: Request, { params }: Context) {
  try {
    return NextResponse.json(await getActivationReadiness((await requireUser()).id, requireOrganisationId(request), (await params).leaseId));
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request, { params }: Context) {
  try {
    return NextResponse.json(await activateExecutedLease((await requireUser()).id, requireOrganisationId(request), (await params).leaseId));
  } catch (error) {
    return errorResponse(error);
  }
}
