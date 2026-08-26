import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";
import { createTenantDepositCheckout } from "@/modules/payments/service";

type Context = { params: Promise<{ tenantId: string }> };

/**
 * Tenant self-service security-deposit checkout, mirroring `/api/tenants/[tenantId]/payments/checkout`.
 * The tenant initiates a provider-backed deposit intent for their own lease; actual success is
 * only ever confirmed asynchronously once the provider's webhook is verified and reconciled into
 * a `SecurityDeposit`.
 */
export async function POST(request: Request, { params }: Context) {
  try {
    const { tenantId } = await params;
    const user = await requireUser();
    const organisationId = requireOrganisationId(request);
    const intent = await createTenantDepositCheckout(user.id, organisationId, tenantId, await request.json());
    return NextResponse.json(intent, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
