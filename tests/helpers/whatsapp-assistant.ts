import { createHmac, randomUUID } from "node:crypto";
import { setWhatsAppTransport } from "@/modules/whatsapp-assistant/cloud-api";
import { ingestWebhook } from "@/modules/whatsapp-assistant/ingest";
import { processContact } from "@/modules/whatsapp-assistant/processor";
import { fakeSms } from "./fake-sms-otp";

/**
 * Test harness for the WhatsApp assistant: builds signed Cloud API webhooks, runs ingestion and
 * processing exactly as production does, and captures every message the assistant sends through a
 * fake Graph API transport. Nothing ever reaches Meta.
 */
export const TEST_APP_SECRET = "test-app-secret-not-real";
export const TEST_PHONE_NUMBER_ID = "100000000000001";

export const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

export function configureAssistantEnv() {
  process.env.WHATSAPP_ASSISTANT_ENABLED = "true";
  process.env.WHATSAPP_APP_SECRET = TEST_APP_SECRET;
  process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = "verify-me";
  process.env.WHATSAPP_ACCESS_TOKEN = "test-access-token";
  process.env.WHATSAPP_PHONE_NUMBER_ID = TEST_PHONE_NUMBER_ID;
  process.env.WHATSAPP_ASSISTANT_AI = "off";
  process.env.WHATSAPP_MEDIA_HOSTS = "lookaside.example";
  delete process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  delete process.env.WHATSAPP_STATUS_TEMPLATE_NAME;
}

export type SentMessage = Record<string, unknown> & { to: string; type: string };

export class FakeGraphApi {
  sent: SentMessage[] = [];
  media = new Map<string, { bytes: Buffer; mimeType: string }>();
  /** Respond to the next N sends with this failure instead of success. */
  failNext: Array<{ status: number; code?: number }> = [];

  install() {
    setWhatsAppTransport(async (url, init) => {
      if (init?.method === "POST" && url.endsWith("/messages")) {
        const failure = this.failNext.shift();
        if (failure) return Response.json({ error: { code: failure.code ?? 1, message: "fake failure" } }, { status: failure.status });
        this.sent.push(JSON.parse(String(init.body)));
        return Response.json({ messages: [{ id: `wamid.out.${randomUUID()}` }] });
      }
      const mediaMatch = url.match(/\/v[\d.]+\/([A-Za-z0-9_-]+)$/);
      if (mediaMatch && this.media.has(mediaMatch[1])) {
        const item = this.media.get(mediaMatch[1])!;
        return Response.json({ url: `https://lookaside.example/media/${mediaMatch[1]}`, mime_type: item.mimeType, file_size: item.bytes.length });
      }
      const download = url.match(/lookaside\.example\/media\/(.+)$/);
      if (download && this.media.has(download[1])) {
        const item = this.media.get(download[1])!;
        return new Response(new Uint8Array(item.bytes), { headers: { "content-type": item.mimeType } });
      }
      return Response.json({ error: { message: "not found" } }, { status: 404 });
    });
    return this;
  }

  uninstall() {
    setWhatsAppTransport(null);
  }

  /** Messages sent since the last call, in order. */
  take() {
    const messages = this.sent;
    this.sent = [];
    return messages;
  }
}

/** Human-readable text of a sent message (body + options), for assertions. */
export function textOf(message: SentMessage): string {
  const type = message.type;
  if (type === "text") return (message.text as { body: string }).body;
  if (type === "image") return (message.image as { caption?: string }).caption ?? "";
  if (type === "template") return JSON.stringify(message.template);
  const interactive = message.interactive as { body: { text: string }; action: { buttons?: Array<{ reply: { title: string } }>; sections?: Array<{ rows: Array<{ title: string }> }> } };
  const options = interactive.action.buttons?.map((button) => button.reply.title) ?? interactive.action.sections?.flatMap((section) => section.rows.map((row) => row.title)) ?? [];
  return `${interactive.body.text}\n${options.map((title) => `[${title}]`).join(" ")}`;
}

/** Ids of the options offered by a sent interactive message. */
export function optionIds(message: SentMessage): string[] {
  if (message.type !== "interactive") return [];
  const interactive = message.interactive as { action: { buttons?: Array<{ reply: { id: string } }>; sections?: Array<{ rows: Array<{ id: string }> }> } };
  return interactive.action.buttons?.map((button) => button.reply.id) ?? interactive.action.sections?.flatMap((section) => section.rows.map((row) => row.id)) ?? [];
}

let clock = Math.floor(Date.now() / 1000);

export type Incoming =
  | { text: string }
  | { choice: string; title?: string }
  | { image: { id: string; caption?: string } }
  | { document: { id: string; mimeType: string; fileName?: string } }
  | { location: { latitude: number; longitude: number; name?: string; address?: string } };

export function webhookBody(from: string, incoming: Incoming, options: { messageId?: string; profileName?: string } = {}) {
  clock += 1;
  const id = options.messageId ?? `wamid.in.${randomUUID()}`;
  const message: Record<string, unknown> = { from, id, timestamp: String(clock) };
  if ("text" in incoming) Object.assign(message, { type: "text", text: { body: incoming.text } });
  if ("choice" in incoming) Object.assign(message, { type: "interactive", interactive: { type: "list_reply", list_reply: { id: incoming.choice, title: incoming.title ?? incoming.choice } } });
  if ("image" in incoming) Object.assign(message, { type: "image", image: { id: incoming.image.id, mime_type: "image/png", caption: incoming.image.caption } });
  if ("document" in incoming) Object.assign(message, { type: "document", document: { id: incoming.document.id, mime_type: incoming.document.mimeType, filename: incoming.document.fileName } });
  if ("location" in incoming) Object.assign(message, { type: "location", location: incoming.location });
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: "WABA", changes: [{ field: "messages", value: {
      messaging_product: "whatsapp",
      metadata: { display_phone_number: "233300000000", phone_number_id: TEST_PHONE_NUMBER_ID },
      contacts: [{ profile: { name: options.profileName ?? "Ama Mensah" }, wa_id: from }],
      messages: [message],
    } }] }],
  });
}

export const sign = (body: string, secret = TEST_APP_SECRET) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

/** Sends one message from `from` and runs processing; returns what the assistant sent back. */
export async function converse(api: FakeGraphApi, from: string, incoming: Incoming, options: { messageId?: string; profileName?: string } = {}) {
  const body = webhookBody(from, incoming, options);
  const result = await ingestWebhook(body, sign(body));
  if (!result.ok) throw new Error(`ingest failed: ${result.reason}`);
  for (const contactId of result.contactIds) await processContact(contactId);
  return api.take();
}

export const allText = (messages: SentMessage[]) => messages.map(textOf).join("\n---\n");

/**
 * Answers the SMS-code prompt with the code the fake SMS gateway "sent" to this number. Requires the
 * test file to `vi.mock("@/modules/messaging/otp-provider", ...)` with `fakeSmsOtpModule`.
 */
export async function answerSmsCode(api: FakeGraphApi, from: string) {
  const code = fakeSms.codes.get(`+${from}`);
  if (!code) throw new Error(`No SMS code was sent to +${from}`);
  return converse(api, from, { text: code });
}
