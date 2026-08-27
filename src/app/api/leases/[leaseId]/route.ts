import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";
import { getLease, updateLease } from "@/modules/leases/service";

export async function GET(request: Request, { params }: { params: Promise<{ leaseId: string }> }) {
  try { return NextResponse.json(await getLease((await requireUser()).id, requireOrganisationId(request), (await params).leaseId)); } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ leaseId: string }> }) {
  try { return NextResponse.json(await updateLease((await requireUser()).id, requireOrganisationId(request), (await params).leaseId, await request.json())); } catch (error) { return errorResponse(error); }
}
