import { processLeaseExpiry } from "@/modules/lifecycle/service";
import { deliverNotification } from "@/modules/notifications/service";
import { defaultNotificationProviders, NotificationProviders } from "@/modules/notifications/providers";
import { scheduleExpiryReminders } from "@/modules/reminders/service";
import { processRentObligationStatuses } from "@/modules/rent-schedules/processing";
import { runProactiveEvaluationJob } from "@/modules/ai-autonomy/service";
import { deliverConversationMessage } from "@/modules/conversations/service";
import { defaultChannelAdapters, ChannelAdapters } from "@/modules/conversations/channels/registry";
import { syncCalendarEventJob } from "@/modules/calendar/service";

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
    await deliverConversationMessage(String(payload.organisationId), String(payload.deliveryId), channelAdapters);
  },
  "calendar-sync": async (payload: Record<string, unknown>) => {
    await syncCalendarEventJob(String(payload.organisationId), String(payload.calendarEventId));
  },
  };
}

export const jobHandlers = createJobHandlers();
