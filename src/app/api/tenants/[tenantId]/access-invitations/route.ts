import { NextResponse } from "next/server";

import {
  createTenantAccessInvitation,
  listTenantAccessInvitations,
} from "@/modules/tenants/access-invitations";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  try {
    const user = await requireUser();
    const organisationId = requireOrganisationId(request);
    const { tenantId } = await params;

    return NextResponse.json({
      invitations: await listTenantAccessInvitations(
        user.id,
        organisationId,
        tenantId,
      ),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  try {
    const user = await requireUser();
    const organisationId = requireOrganisationId(request);
    const { tenantId } = await params;

    const result = await createTenantAccessInvitation(
      user.id,
      organisationId,
      tenantId,
    );

    return NextResponse.json(result, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
