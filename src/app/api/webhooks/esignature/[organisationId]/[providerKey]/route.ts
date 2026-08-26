import { NextResponse } from "next/server";
import { processSignatureProviderEvent } from "@/modules/esignature/service";
import { esignatureProviders } from "@/modules/esignature/provider";
import { errorResponse } from "@/platform/errors";

type Context = { params: Promise<{ organisationId: string; providerKey: string }> };

/**
 * Verified, replay-protected e-signature provider webhook (item 4). A signer's status can only
 * ever move to SIGNED/DECLINED/VIEWED through this verified path; every inbound call is persisted
 * via `SignatureProviderEvent`, whether matched, mismatched, unmatched, or a replay/duplicate.
 */
export async function POST(request: Request, { params }: Context) {
  try {
    const { organisationId, providerKey } = await params;
    const rawBody = await request.text();
    const adapter = esignatureProviders.get(providerKey);
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
    const result = await processSignatureProviderEvent(organisationId, providerKey, payload);
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
