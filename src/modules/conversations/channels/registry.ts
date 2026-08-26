import type { ConversationChannel } from "@/platform/database/generated/client";
import type { ChannelAdapter } from "./types";
import { InAppChannelAdapter } from "./webchat";
import { EmailChannelAdapter } from "./email";
import { WhatsAppChannelAdapter } from "./whatsapp";
import { SmsChannelAdapter } from "./sms";

export const defaultChannelAdapters: Record<ConversationChannel, ChannelAdapter> = {
  WEB_CHAT: new InAppChannelAdapter("WEB_CHAT"),
  IN_APP: new InAppChannelAdapter("IN_APP"),
  EMAIL: new EmailChannelAdapter(),
  WHATSAPP: new WhatsAppChannelAdapter(),
  SMS: new SmsChannelAdapter(),
};

export type ChannelAdapters = Record<ConversationChannel, ChannelAdapter>;

export function getChannelAdapter(channel: ConversationChannel, adapters: ChannelAdapters = defaultChannelAdapters): ChannelAdapter {
  return adapters[channel];
}

export { InAppChannelAdapter, EmailChannelAdapter, WhatsAppChannelAdapter, SmsChannelAdapter };
export * from "./types";
