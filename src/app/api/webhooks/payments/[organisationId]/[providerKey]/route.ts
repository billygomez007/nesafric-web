import { NextResponse } from "next/server";
import { reconcileProviderEvent } from "@/modules/payments/service";
import { paymentProviders } from "@/modules/payments/providers";
// Side-effect import: ensures the Ghana gateway adapters are registered even if this route is
// the first module in the payments package to load in a given server process.
import "@/modules/payments/gateways";
import { errorResponse } from "@/platform/errors";

type Context = { params: Promise<{ organisationId: string; providerKey: string }> };

/**
 * Asynchronous payment-provider webhook receiver. Money can only ever be marked as collected
 * through this verified, replay-protected path — a checkout redirect back to the app must never
 * be treated as a success signal. Every inbound call is persisted via
 * `reconcileProviderEvent`'s `PaymentReconciliationEvent` ledger, whether it ends up matched,
 * mismatched, unmatched, or a replay/duplicate.
 */
export async function POST(request: Request, { params }: Context) {
  try {
    const { organisationId, providerKey } = await params;
    const rawBody = await request.text();
    const adapter = paymentProviders.get(providerKey);
    // A registered adapter that does not implement `verifyWebhookSignature` at all can never be
    // trusted with a webhook: unlike an implemented-but-unconfigured check (which returns
    // `{ verified: false, reason: "not-configured" }` below), a missing method means there is no
    // way to ever verify this provider's callbacks, so it must be rejected outright rather than
    // silently accepted as if it were pre-verified.
    if (!adapter.verifyWebhookSignature) return new NextResponse("Signature verification is not supported for this provider", { status: 401 });
    const headers: Record<string, string | null> = {};
    request.headers.forEach((value, key) => { headers[key.toLowerCase()] = value; });
    const verification = adapter.verifyWebhookSignature(rawBody, headers);
    // Unlike inbound conversation channels, an unconfigured or unverifiable payment webhook is
    // never trusted: real money reconciliation requires a verified signature, full stop.
    if (!verification.verified) return new NextResponse("Signature verification failed", { status: 401 });
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: { code: "INVALID_PAYLOAD", message: "The webhook body is not valid JSON." } }, { status: 400 });
    }
    const result = await reconcileProviderEvent(organisationId, providerKey, payload);
    const payment = "payment" in result ? (result.payment as { id: string } | null | undefined) : null;
    const securityDeposit = "securityDeposit" in result ? (result.securityDeposit as { id: string } | null | undefined) : null;
    return NextResponse.json({ status: result.status, paymentId: payment?.id ?? null, securityDepositId: securityDeposit?.id ?? null });
  } catch (error) {
    return errorResponse(error);
  }
}
