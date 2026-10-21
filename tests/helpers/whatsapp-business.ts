import { randomUUID } from "node:crypto";
import { advanceOfficialConversation } from "@/modules/whatsapp-assistant/router";

/**
 * Drives the official-number conversation the way the message processor does: each message gets
 * the state the previous reply left, and a unique message id unless one is given (a redelivery).
 */
export function whatsappConversation(phone: string, organisationId: string) {
  let state: unknown = {};
  let count = 0;
  const send = async (message: string | { image: string }, messageId = `wamid.${++count}.${randomUUID()}`) => {
    const content = typeof message === "string" ? { body: message, kind: "text" } : { body: "[image received]", kind: "image", media: { id: message.image, mimeType: "image/jpeg" } };
    const result = await advanceOfficialConversation({ state, ...content, phone, conversationId: randomUUID(), messageId, defaultCountry: "GH", defaultCurrency: "GHS", organisationId });
    state = result.state;
    return result;
  };
  return {
    send,
    /** Sends each message in turn and returns the last reply. */
    async say(...messages: Array<string | { image: string }>) {
      let last = await send(messages[0]);
      for (const message of messages.slice(1)) last = await send(message);
      return last;
    },
    get state() { return state as { workflow: string; business?: { draftId: string } }; },
    reset() { state = {}; },
  };
}

/** Media ids starting with "9" fail to download (a Meta outage); others return an image. */
export const failingMediaId = (n: number) => `9${String(n).padStart(5, "0")}`;
export const mediaId = (n: number) => `1${String(n).padStart(5, "0")}`;
