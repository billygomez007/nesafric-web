import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";
import { createTenantPaymentCheckout } from "@/modules/payments/service";

type Context = { params: Promise<{ tenantId: string }> };

/**
 * Mobile tenant self-service checkout. The tenant initiates a Mobile Money (or other
 * provider-neutral) payment intent for their own lease; the response only ever reflects the
 * checkout's `PENDING`/`PROCESSING` state returned by the provider adapter — actual success is
 * only ever confirmed asynchronously once the provider's webhook is verified and reconciled.
 */
export async function POST(request: Request, { params }: Context) {
  try {
    const { tenantId } = await params;
    const user = await requireUser();
    const organisationId = requireOrganisationId(request);
    const intent = await createTenantPaymentCheckout(user.id, organisationId, tenantId, await request.json());
    return NextResponse.json(intent, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
