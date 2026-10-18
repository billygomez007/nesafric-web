import { after, NextResponse } from "next/server";
import { verifySubscription } from "@/modules/whatsapp-assistant/cloud-api";
import { whatsAppAssistantConfig } from "@/modules/whatsapp-assistant/config";
import { ingestWebhook } from "@/modules/whatsapp-assistant/ingest";
import { processContact } from "@/modules/whatsapp-assistant/processor";
import { errorLabel } from "@/modules/whatsapp-assistant/log";

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
    // The signature covers the exact bytes Meta sent, so verify those, not re-encoded text.
    const result = await ingestWebhook(Buffer.from(await request.arrayBuffer()), request.headers.get("x-hub-signature-256"));
    if (!result.ok) return NextResponse.json({ error: result.reason }, { status: result.status });
    // Acknowledge only after the messages and their processing jobs are committed (above). Replying
    // after the response is an acceleration: if it never runs, the job and the recovery sweep in
    // /api/jobs/run (and `npm run worker`) process the stored messages.
    after(async () => {
      for (const contactId of result.contactIds) {
        await processContact(contactId).catch((error) => {
          console.error("[whatsapp-assistant] immediate processing failed; the retry job will pick it up", { error: errorLabel(error) });
        });
      }
    });
    return NextResponse.json({ received: true, stored: result.stored, duplicates: result.duplicates });
  } catch (error) {
    // Not `errorResponse`: it logs the raw error, which could include message content. A 500 makes
    // Meta redeliver, and the duplicate is handled idempotently.
    console.error("[whatsapp-assistant] webhook ingestion failed", { error: errorLabel(error) });
    return NextResponse.json({ error: "Internal error." }, { status: 500 });
  }
}
