import { after, NextResponse } from "next/server";
import { verifySubscription } from "@/modules/whatsapp-assistant/cloud-api";
import { whatsAppAssistantConfig } from "@/modules/whatsapp-assistant/config";
import { ingestWebhook } from "@/modules/whatsapp-assistant/ingest";
import { processContact } from "@/modules/whatsapp-assistant/processor";
import { errorResponse } from "@/platform/errors";

/**
 * NesAfric's platform WhatsApp number (WhatsApp Cloud API). Distinct from the per-organisation
 * tenant inbox webhook at `/api/webhooks/whatsapp/[organisationId]`.
 */
export const maxDuration = 60;

/** Meta webhook subscription handshake. */
export async function GET(request: Request) {
  const config = whatsAppAssistantConfig();
  if (!config.enabled) return new NextResponse("Not found", { status: 404 });
  const challenge = verifySubscription(new URL(request.url).searchParams, config.verifyToken);
  if (!challenge) return new NextResponse("Forbidden", { status: 403 });
  return new NextResponse(challenge, { status: 200, headers: { "content-type": "text/plain" } });
}

export async function POST(request: Request) {
  try {
    const result = await ingestWebhook(await request.text(), request.headers.get("x-hub-signature-256"));
    if (!result.ok) return NextResponse.json({ error: result.reason }, { status: result.status });
    // Acknowledge now; reply after the response. A durable job retries anything this misses.
    after(async () => {
      for (const contactId of result.contactIds) {
        await processContact(contactId).catch((error) => {
          console.error("[whatsapp-assistant] immediate processing failed; the retry job will pick it up", { error: error instanceof Error ? error.message : "unknown" });
        });
      }
    });
    return NextResponse.json({ received: true, stored: result.stored, duplicates: result.duplicates });
  } catch (error) {
    return errorResponse(error);
  }
}
