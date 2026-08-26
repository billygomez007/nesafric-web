import { NextResponse } from "next/server";
import { processBillingWebhookEvent } from "@/modules/subscriptions/lifecycle";
import { getBillingAdapter } from "@/modules/billing/service";
// Side-effect import: ensures the deterministic test and HTTP billing adapters are registered.
import "@/modules/billing/gateways";
import { errorResponse } from "@/platform/errors";

type Context = { params: Promise<{ providerKey: string }> };

/**
 * Asynchronous SaaS-billing provider webhook receiver (item 5), strictly separate from the tenant
 * rent-collection webhook (`/api/webhooks/payments/...`) — different route, different registry,
 * different tables. A single URL is registered once with the billing provider (there is no
 * per-organisation path segment): the organisation is resolved from the verified event's own
 * subscription reference. Every inbound call is fail-closed — the raw body is read and its
 * signature verified *before* the payload is ever parsed or persisted, and the outcome (matched,
 * unmatched, mismatched, duplicate/replay, failed) is always durably recorded via
 * `BillingWebhookEvent`.
 */
export async function POST(request: Request, { params }: Context) {
  try {
    const { providerKey } = await params;
    const rawBody = await request.text();
    const adapter = getBillingAdapter(providerKey);
    const headers: Record<string, string | null> = {};
    request.headers.forEach((value, key) => { headers[key.toLowerCase()] = value; });
    const verification = adapter.verifyWebhookSignature(rawBody, headers);
    if (!verification.verified) return new NextResponse("Signature verification failed", { status: 401 });
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: { code: "INVALID_PAYLOAD", message: "The webhook body is not valid JSON." } }, { status: 400 });
    }
    const result = await processBillingWebhookEvent(providerKey, payload);
    return NextResponse.json({ status: result.status });
  } catch (error) {
    return errorResponse(error);
  }
}
