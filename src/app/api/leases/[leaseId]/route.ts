import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { AppError, errorResponse } from "@/platform/errors";
import { getLease, updateLease } from "@/modules/leases/service";

function organisationId(request: Request) {
  const value = request.headers.get("x-organisation-id");
  if (!value) throw new AppError("ORGANISATION_REQUIRED", 400, "An active organisation is required.");
  return value;
}

export async function GET(request: Request, { params }: { params: Promise<{ leaseId: string }> }) {
  try { return NextResponse.json(await getLease((await requireUser()).id, organisationId(request), (await params).leaseId)); } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ leaseId: string }> }) {
  try { return NextResponse.json(await updateLease((await requireUser()).id, organisationId(request), (await params).leaseId, await request.json())); } catch (error) { return errorResponse(error); }
}
