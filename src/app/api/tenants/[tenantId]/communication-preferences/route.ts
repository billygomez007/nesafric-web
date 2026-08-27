import { NextResponse } from "next/server";
import { updateTenantCommunicationPreferences } from "@/modules/tenants/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

export async function PATCH(request: Request, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    return NextResponse.json(await updateTenantCommunicationPreferences(
      (await requireUser()).id,
      requireOrganisationId(request),
      (await params).tenantId,
      await request.json(),
    ));
  } catch (error) {
    return errorResponse(error);
  }
}
