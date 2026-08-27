import { db } from "@/platform/database/client";
import { EmailChannelAdapter, SmsChannelAdapter, WhatsAppChannelAdapter } from "@/modules/conversations/channels/registry";
import type { ChannelAdapter } from "@/modules/conversations/channels/types";

export type DeliveryChannel = "IN_APP" | "EMAIL" | "SMS" | "WHATSAPP";

export type DeliveryRequest = {
  notificationId: string;
  organisationId: string;
  channel: DeliveryChannel;
  eventType: string;
  tenantOrganisationId: string | null;
  leaseId: string | null;
};

export type DeliveryResult = {
  status: "SENT" | "DELIVERED";
  providerReference?: string;
};

export interface NotificationProvider {
  deliver(request: DeliveryRequest): Promise<DeliveryResult>;
}

export type NotificationProviders = Record<DeliveryChannel, NotificationProvider>;

const EVENT_MESSAGES: Record<string, string> = {
  LEASE_EXPIRY: "Your lease is approaching its expiry date.",
  RENT_DUE: "A rent payment is due soon.",
  RENT_OVERDUE: "A rent payment is overdue.",
  DOCUMENT_EXPIRY: "A document on file is approaching its expiry date.",
  INSPECTION_DUE: "A property inspection is due.",
  MAINTENANCE_FOLLOWUP: "There is a follow-up on your maintenance request.",
  PAYMENT_RECEIVED: "A payment has been received.",
  PAYMENT_FAILED: "A payment attempt failed.",
  SUBSCRIPTION_TRIAL_ENDING: "Your subscription trial is ending soon.",
  SUBSCRIPTION_BILLING_ISSUE: "There is an issue with your subscription billing.",
  SUBSCRIPTION_ACTIVATED: "Your subscription has been activated.",
  SUBSCRIPTION_CHANGED: "Your subscription plan has changed.",
  SUBSCRIPTION_GRACE_PERIOD: "Your subscription is in a billing grace period.",
  SUBSCRIPTION_SUSPENDED: "Your subscription has been suspended.",
  ENTITLEMENT_LIMIT_APPROACHING: "You are approaching a plan usage limit.",
  ENTITLEMENT_LIMIT_REACHED: "You have reached a plan usage limit.",
};

function renderMessageBody(request: DeliveryRequest) {
  return EVENT_MESSAGES[request.eventType] ?? "You have a new notification.";
}

/** Recipient address for a tenant-scoped notification, from the tenant's own contact record —
 * never inferred/guessed, and null when no tenant is attached (e.g. a subscription/entitlement
 * notification, which has no tenant recipient and is IN_APP-only in practice). */
async function resolveTenantAddress(tenantOrganisationId: string | null, field: "email" | "phone") {
  if (!tenantOrganisationId) return null;
  const tenantOrganisation = await db.tenantOrganisation.findUnique({ where: { id: tenantOrganisationId }, select: { email: true, phone: true } });
  return tenantOrganisation?.[field] ?? null;
}

/**
 * Wraps an existing, already-credential-gated `ChannelAdapter` (from the conversations module —
 * the real, working provider-neutral SMS/WhatsApp/email transport) as a `NotificationProvider`,
 * instead of duplicating provider logic here. Previously this module had its own always-throwing
 * `UnconfiguredProvider` stand-ins for EMAIL/SMS/WHATSAPP that never actually checked the
 * conversations module's credentials, so every reminder configured on those channels failed
 * unconditionally regardless of configuration — this reuses the real adapters instead.
 */
class ChannelAdapterNotificationProvider implements NotificationProvider {
  constructor(
    private readonly adapter: ChannelAdapter,
    private readonly addressField: "email" | "phone",
  ) {}

  async deliver(request: DeliveryRequest): Promise<DeliveryResult> {
    const recipientAddress = await resolveTenantAddress(request.tenantOrganisationId, this.addressField);
    if (!recipientAddress) throw new Error(`No ${this.addressField} address is on file for this recipient.`);
    const result = await this.adapter.send({
      organisationId: request.organisationId,
      conversationId: request.notificationId,
      messageId: request.notificationId,
      channel: this.adapter.channel,
      recipientAddress,
      fromAddress: null,
      body: renderMessageBody(request),
    });
    if (result.status === "SENT" || result.status === "DELIVERED") return { status: result.status, providerReference: result.providerReference };
    throw new Error(result.failureReason ?? `${this.adapter.channel} delivery failed.`);
  }
}

export const defaultNotificationProviders: NotificationProviders = {
  IN_APP: {
    async deliver(request) {
      return { status: "DELIVERED", providerReference: `in-app:${request.notificationId}` };
    },
  },
  EMAIL: new ChannelAdapterNotificationProvider(new EmailChannelAdapter(), "email"),
  SMS: new ChannelAdapterNotificationProvider(new SmsChannelAdapter(), "phone"),
  WHATSAPP: new ChannelAdapterNotificationProvider(new WhatsAppChannelAdapter(), "phone"),
};
