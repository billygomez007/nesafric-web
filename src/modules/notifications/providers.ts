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

class UnconfiguredProvider implements NotificationProvider {
  constructor(private readonly channel: Exclude<DeliveryChannel, "IN_APP">) {}

  async deliver(): Promise<DeliveryResult> {
    throw new Error(`${this.channel} notification provider is not configured.`);
  }
}

export const defaultNotificationProviders: NotificationProviders = {
  IN_APP: {
    async deliver(request) {
      return { status: "DELIVERED", providerReference: `in-app:${request.notificationId}` };
    },
  },
  EMAIL: new UnconfiguredProvider("EMAIL"),
  SMS: new UnconfiguredProvider("SMS"),
  WHATSAPP: new UnconfiguredProvider("WHATSAPP"),
};
