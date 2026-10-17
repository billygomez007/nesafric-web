/**
 * Configuration for the platform-level NesAfric WhatsApp assistant (WhatsApp Cloud API).
 * Credentials come only from environment variables; nothing here is ever logged or stored.
 */
const nonEmpty = (value: string | undefined) => value?.trim() || undefined;

export type WhatsAppAssistantConfig = {
  enabled: boolean;
  phoneNumberId?: string;
  businessAccountId?: string;
  accessToken?: string;
  appSecret?: string;
  verifyToken?: string;
  graphApiVersion: string;
  graphApiBaseUrl: string;
  /** Approved template used for notifications sent outside the 24-hour customer-service window. */
  statusTemplateName?: string;
  statusTemplateLanguage: string;
  maxMediaBytes: number;
};

export function whatsAppAssistantConfig(): WhatsAppAssistantConfig {
  return {
    enabled: process.env.WHATSAPP_ASSISTANT_ENABLED === "true",
    phoneNumberId: nonEmpty(process.env.WHATSAPP_PHONE_NUMBER_ID),
    businessAccountId: nonEmpty(process.env.WHATSAPP_BUSINESS_ACCOUNT_ID),
    accessToken: nonEmpty(process.env.WHATSAPP_ACCESS_TOKEN),
    appSecret: nonEmpty(process.env.WHATSAPP_APP_SECRET),
    verifyToken: nonEmpty(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN),
    graphApiVersion: nonEmpty(process.env.WHATSAPP_GRAPH_API_VERSION) ?? "v21.0",
    graphApiBaseUrl: (nonEmpty(process.env.WHATSAPP_GRAPH_API_BASE_URL) ?? "https://graph.facebook.com").replace(/\/+$/, ""),
    statusTemplateName: nonEmpty(process.env.WHATSAPP_STATUS_TEMPLATE_NAME),
    statusTemplateLanguage: nonEmpty(process.env.WHATSAPP_STATUS_TEMPLATE_LANGUAGE) ?? "en",
    maxMediaBytes: Number(process.env.WHATSAPP_MAX_MEDIA_BYTES) > 0 ? Number(process.env.WHATSAPP_MAX_MEDIA_BYTES) : 10 * 1024 * 1024,
  };
}

/** Whether outbound sending is possible (token + phone number id). */
export function canSendWhatsApp(config = whatsAppAssistantConfig()) {
  return Boolean(config.accessToken && config.phoneNumberId);
}
