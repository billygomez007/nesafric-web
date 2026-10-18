import { receiveWhatsAppWebhook, verifyWhatsAppWebhook } from "@/modules/whatsapp-assistant/webhook";

type Context = { params: Promise<{ organisationId: string }> };

/** An organisation's own WhatsApp number. The official NesAfric number uses /api/webhooks/whatsapp. */
export async function GET(request: Request, { params }: Context) {
  return verifyWhatsAppWebhook(request, (await params).organisationId);
}

export async function POST(request: Request, { params }: Context) {
  return receiveWhatsAppWebhook(request, (await params).organisationId);
}
