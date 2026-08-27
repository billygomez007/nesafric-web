import { NextResponse } from "next/server";
import { errorResponse } from "@/platform/errors";
import { ingestProviderWebhook } from "@/modules/voice/service";

type Context = { params: Promise<{ providerKey: string }> };

/** Asynchronous voice-provider webhook receiver (item 1/13/20) — every call status transition is
 * signature-verified and deduplicated before it can affect any call state. Mirrors the payments
 * webhook receiver's trust model exactly. */
export async function POST(request: Request, { params }: Context) {
  try {
    const { providerKey } = await params;
    const rawBody = await request.text();
    const headers: Record<string, string | null> = {};
    request.headers.forEach((value, key) => { headers[key.toLowerCase()] = value; });
    const result = await ingestProviderWebhook(providerKey, rawBody, headers);
    return NextResponse.json({ callId: result.call.id, replay: result.replay });
  } catch (error) {
    return errorResponse(error);
  }
}
