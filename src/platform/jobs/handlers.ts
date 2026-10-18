import { processLeaseExpiry } from "@/modules/lifecycle/service";
import { deliverNotification } from "@/modules/notifications/service";
import { defaultNotificationProviders, NotificationProviders } from "@/modules/notifications/providers";
import { scheduleExpiryReminders } from "@/modules/reminders/service";
import { processRentObligationStatuses } from "@/modules/rent-schedules/processing";
import { runProactiveEvaluationJob } from "@/modules/ai-autonomy/service";
import { deliverConversationMessage } from "@/modules/conversations/service";
import { defaultChannelAdapters, ChannelAdapters } from "@/modules/conversations/channels/registry";
import { syncCalendarEventJob } from "@/modules/calendar/service";
import { sendAccountEmail, type AccountEmailPayload } from "@/modules/account-emails/service";
import { processAssistantMessage, processLegacyWhatsAppMessage, recordWhatsAppDeliveryStatus } from "@/modules/whatsapp-assistant/service";
import type { WhatsAppStatusEvent } from "@/modules/conversations/channels/whatsapp-payload";
import { NonRetryableJobError } from "./errors";

export function createJobHandlers(notificationProviders: NotificationProviders = defaultNotificationProviders, channelAdapters: ChannelAdapters = defaultChannelAdapters) {
  return {
  "lease-expiry": async (payload: Record<string, unknown>) => {
    await processLeaseExpiry(String(payload.systemUserId), String(payload.organisationId), String(payload.leaseId));
  },
  "rent-obligation-status": async (payload: Record<string, unknown>) => {
    await processRentObligationStatuses(String(payload.organisationId));
  },
  "lease-expiry-reminders": async (payload: Record<string, unknown>) => {
    await scheduleExpiryReminders(String(payload.systemUserId), String(payload.organisationId));
  },
  "notification-delivery": async (payload: Record<string, unknown>) => {
    await deliverNotification(String(payload.organisationId), String(payload.notificationId), notificationProviders);
  },
  "ai-proactive-evaluation": async (payload: Record<string, unknown>) => {
    await runProactiveEvaluationJob(String(payload.organisationId));
  },
  "conversation-message-delivery": async (payload: Record<string, unknown>) => {
    const delivery = await deliverConversationMessage(String(payload.organisationId), String(payload.deliveryId), channelAdapters);
    if (delivery.status === "FAILED") {
      const retryable = "retryable" in delivery ? delivery.retryable : true;
      if (!retryable) throw new NonRetryableJobError(`Conversation message delivery failed permanently: ${delivery.failureReason ?? "see the delivery record"}.`);
      throw new Error("Conversation message delivery failed; see the delivery record.");
    }
    // Never resend automatically: the provider may already have the message.
    if (delivery.status === "SENDING" || delivery.status === "UNCONFIRMED") throw new NonRetryableJobError("Conversation delivery has an unconfirmed send attempt; review before retrying.");
  },
  "whatsapp-assistant-message": processAssistantMessage,
  "whatsapp-legacy-inbound": processLegacyWhatsAppMessage,
  "whatsapp-delivery-status": async (payload: Record<string, unknown>) => {
    await recordWhatsAppDeliveryStatus(String(payload.organisationId), payload.status as WhatsAppStatusEvent);
  },
  "calendar-sync": async (payload: Record<string, unknown>) => {
    await syncCalendarEventJob(String(payload.organisationId), String(payload.calendarEventId));
  },
  "account-email": async (payload: Record<string, unknown>) => {
    await sendAccountEmail(payload as unknown as AccountEmailPayload);
  },
  };
}

export const jobHandlers = createJobHandlers();
