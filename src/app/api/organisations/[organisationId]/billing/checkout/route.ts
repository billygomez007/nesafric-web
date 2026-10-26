import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { getCheckoutStatus, startPlanCheckout } from "@/modules/subscriptions/checkout";
// Side-effect import: registers the billing provider adapters.
import "@/modules/billing/gateways";

type Context = { params: Promise<{ organisationId: string }> };

/** Status of a checkout after the customer returns from the payment page. Read-only: returning
 * from the provider never activates a plan; only the provider's signed webhook does. */
export async function GET(request: Request, { params }: Context) {
  try {
    const { organisationId } = await params;
    const checkoutId = new URL(request.url).searchParams.get("id");
    if (!checkoutId) return NextResponse.json({ error: { code: "CHECKOUT_ID_REQUIRED", message: "An id query parameter is required." } }, { status: 400 });
    return NextResponse.json(await getCheckoutStatus((await requireUser()).id, organisationId, checkoutId));
  } catch (error) {
    return errorResponse(error);
  }
}

/** Starts a hosted checkout for a plan. The body carries only `planKey` and an idempotency key;
 * the price is always taken from the server's plan configuration. */
export async function POST(request: Request, { params }: Context) {
  try {
    const { organisationId } = await params;
    const { checkout, conflicts } = await startPlanCheckout((await requireUser()).id, organisationId, await request.json());
    return NextResponse.json({ checkoutId: checkout.id, checkoutUrl: checkout.checkoutUrl, status: checkout.status, conflicts });
  } catch (error) {
    return errorResponse(error);
  }
}
