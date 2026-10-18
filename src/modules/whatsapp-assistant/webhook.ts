import { NextResponse } from "next/server";
import { getWebhookChannelConfig } from "@/modules/conversations/service";
import { WhatsAppChannelAdapter } from "@/modules/conversations/channels/whatsapp";
import { AppError, errorResponse } from "@/platform/errors";
import { assistantChannelConfigSchema } from "./schemas";
import { acceptWhatsAppEvents } from "./service";

const adapter = new WhatsAppChannelAdapter();

/** Meta-shaped webhook handshake: `hub.mode` / `hub.verify_token` / `hub.challenge`. */
export async function verifyWhatsAppWebhook(request: Request, organisationId: string) {
  const url = new URL(request.url);
  const config = await getWebhookChannelConfig(organisationId, "WHATSAPP");
  if (!config?.enabled) return new NextResponse("Forbidden", { status: 403 });
  const challenge = adapter.verifyChallenge(
    url.searchParams.get("hub.mode"),
    url.searchParams.get("hub.verify_token"),
    url.searchParams.get("hub.challenge"),
    config?.webhookVerifyToken ?? null,
  );
  if (!challenge) return new NextResponse("Forbidden", { status: 403 });
  return new NextResponse(challenge, { status: 200 });
}

/** Signature first, then a fast durable receipt. Processing happens in background jobs. */
export async function receiveWhatsAppWebhook(request: Request, organisationId: string) {
  try {
    const config = await getWebhookChannelConfig(organisationId, "WHATSAPP");
    if (!config?.enabled || !process.env.WHATSAPP_APP_SECRET) return new NextResponse("WhatsApp webhook is not configured", { status: 503 });
    const channel = assistantChannelConfigSchema.safeParse(config.config);
    if (!channel.success) return new NextResponse("WhatsApp receiving number is not configured", { status: 503 });
    const rawBody = await readWebhookBody(request);
    const verification = adapter.verifyWebhookSignature(rawBody, { "x-hub-signature-256": request.headers.get("x-hub-signature-256") }, process.env.WHATSAPP_APP_SECRET);
    if (!verification.verified) {
      return new NextResponse("Signature verification failed", { status: 401 });
    }
    let payload: unknown;
    try { payload = JSON.parse(rawBody); } catch { throw new AppError("INVALID_JSON", 400, "Invalid webhook JSON."); }
    return NextResponse.json(await acceptWhatsAppEvents(organisationId, channel.data, payload));
  } catch (error) {
    return errorResponse(error);
  }
}

async function readWebhookBody(request: Request) {
  const maxBytes = 1024 * 1024;
  if (Number(request.headers.get("content-length")) > maxBytes) throw new AppError("WEBHOOK_TOO_LARGE", 413, "Webhook exceeds 1 MiB.");
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new AppError("WEBHOOK_TOO_LARGE", 413, "Webhook exceeds 1 MiB."); }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally { reader.releaseLock(); }
}
