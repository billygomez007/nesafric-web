import { NextResponse } from "next/server";
import { getWebhookChannelConfig, receiveInboundChannelMessage } from "@/modules/conversations/service";
import { WhatsAppChannelAdapter } from "@/modules/conversations/channels/whatsapp";
import { errorResponse } from "@/platform/errors";

const adapter = new WhatsAppChannelAdapter();

type Context = { params: Promise<{ organisationId: string }> };

/** Meta-shaped webhook handshake: `hub.mode` / `hub.verify_token` / `hub.challenge`. */
export async function GET(request: Request, { params }: Context) {
  const { organisationId } = await params;
  const url = new URL(request.url);
  const config = await getWebhookChannelConfig(organisationId, "WHATSAPP");
  const challenge = adapter.verifyChallenge(
    url.searchParams.get("hub.mode"),
    url.searchParams.get("hub.verify_token"),
    url.searchParams.get("hub.challenge"),
    config?.webhookVerifyToken ?? null,
  );
  if (!challenge) return new NextResponse("Forbidden", { status: 403 });
  return new NextResponse(challenge, { status: 200 });
}

export async function POST(request: Request, { params }: Context) {
  try {
    const { organisationId } = await params;
    const rawBody = await request.text();
    const config = await getWebhookChannelConfig(organisationId, "WHATSAPP");
    const verification = adapter.verifyWebhookSignature(rawBody, { "x-hub-signature-256": request.headers.get("x-hub-signature-256") }, config?.webhookVerifyToken ?? null);
    if (!verification.verified && verification.reason !== "not-configured") {
      return new NextResponse("Signature verification failed", { status: 401 });
    }
    const payload = JSON.parse(rawBody);
    const messages = adapter.normalizeInbound(payload);
    const results = [];
    for (const message of messages) {
      results.push(await receiveInboundChannelMessage(organisationId, "WHATSAPP", message));
    }
    return NextResponse.json({ processed: results.length, results });
  } catch (error) {
    return errorResponse(error);
  }
}
