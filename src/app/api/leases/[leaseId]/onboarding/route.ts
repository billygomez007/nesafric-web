import { NextResponse } from "next/server";
import { getTenantOnboarding } from "@/modules/lease-execution/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

export async function GET(request: Request, { params }: { params: Promise<{ leaseId: string }> }) {
  try {
    return NextResponse.json(await getTenantOnboarding((await requireUser()).id, requireOrganisationId(request), (await params).leaseId));
  } catch (error) {
    return errorResponse(error);
  }
}
