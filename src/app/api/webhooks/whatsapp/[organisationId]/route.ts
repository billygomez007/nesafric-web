import { receiveWhatsAppWebhook, verifyWhatsAppWebhook } from "@/modules/whatsapp-assistant/webhook";
import { drainReplyPathAfterResponse } from "@/platform/jobs/fast-path";

/** Room for the reply path that runs after the response; matches the processing deadline. */
export const maxDuration = 120;

type Context = { params: Promise<{ organisationId: string }> };

/** An organisation's own WhatsApp number. The official NesAfric number uses /api/webhooks/whatsapp. */
export async function GET(request: Request, { params }: Context) {
  return verifyWhatsAppWebhook(request, (await params).organisationId);
}

export async function POST(request: Request, { params }: Context) {
  const response = await receiveWhatsAppWebhook(request, (await params).organisationId);
  // Only an accepted delivery has anything new to process.
  if (response.status === 200) drainReplyPathAfterResponse();
  return response;
}
