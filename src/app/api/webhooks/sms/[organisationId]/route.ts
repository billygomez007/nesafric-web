import { NextResponse } from "next/server";
import { getWebhookChannelConfig, receiveInboundChannelMessage } from "@/modules/conversations/service";
import { SmsChannelAdapter } from "@/modules/conversations/channels/sms";
import { errorResponse } from "@/platform/errors";

const adapter = new SmsChannelAdapter();

type Context = { params: Promise<{ organisationId: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    const { organisationId } = await params;
    const rawBody = await request.text();
    const config = await getWebhookChannelConfig(organisationId, "SMS");
    const verification = adapter.verifyWebhookSignature(rawBody, { "x-webhook-signature": request.headers.get("x-webhook-signature") }, config?.webhookVerifyToken ?? null);
    if (!verification.verified && verification.reason !== "not-configured") {
      return new NextResponse("Signature verification failed", { status: 401 });
    }
    const payload = JSON.parse(rawBody);
    const messages = adapter.normalizeInbound(payload);
    const results = [];
    for (const message of messages) {
      results.push(await receiveInboundChannelMessage(organisationId, "SMS", message));
    }
    return NextResponse.json({ processed: results.length, results });
  } catch (error) {
    return errorResponse(error);
  }
}
