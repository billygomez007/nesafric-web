import { NextResponse } from "next/server";

import {
  createTenantAccessInvitation,
  listTenantAccessInvitations,
} from "@/modules/tenants/access-invitations";
import { deliverTenantAccessInvitation } from "@/modules/tenants/access-delivery";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";
import { isUuid } from "@/platform/validation/uuid";

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

    const body = await request.json().catch(() => ({}));
    const leaseId =
      typeof body?.leaseId === "string" && body.leaseId.trim()
        ? body.leaseId.trim()
        : undefined;

    if (leaseId && !isUuid(leaseId)) {
      return NextResponse.json(
        { error: { code: "INVALID_LEASE_ID", message: "leaseId must be a valid UUID." } },
        { status: 422 },
      );
    }

    const result = await createTenantAccessInvitation(
      user.id,
      organisationId,
      tenantId,
      leaseId,
    );

    const delivery = await deliverTenantAccessInvitation({
      tenantOrganisationId: tenantId,
      invitationId: result.invitation.id,
      expiresAt: result.invitation.expiresAt,
      code: result.code,
      leaseId,
    });

    return NextResponse.json(
      {
        invitation: result.invitation,
        delivery,
      },
      {
        status: 201,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
