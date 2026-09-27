import { NextResponse } from "next/server";

import { revokeTenantAccessInvitation } from "@/modules/tenants/access-invitations";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

export async function DELETE(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ tenantId: string; invitationId: string }>;
  },
) {
  try {
    const user = await requireUser();
    const organisationId = requireOrganisationId(request);
    const { tenantId, invitationId } = await params;

    return NextResponse.json(
      await revokeTenantAccessInvitation(
        user.id,
        organisationId,
        tenantId,
        invitationId,
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
