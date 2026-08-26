import { NextResponse } from "next/server";
import { createLeaseDocumentVersion } from "@/modules/lease-execution/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

export async function POST(request: Request, { params }: { params: Promise<{ leaseId: string }> }) {
  try {
    return NextResponse.json(await createLeaseDocumentVersion((await requireUser()).id, requireOrganisationId(request), (await params).leaseId, await request.json()), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
