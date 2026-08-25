import { transitionLease } from "@/modules/lifecycle/service";
import { scheduleExpiryReminders } from "@/modules/reminders/service";
import { processRentObligationStatuses } from "@/modules/rent-schedules/processing";

export const jobHandlers = {
  "lease-expiry": async (payload: Record<string, unknown>) => {
    await transitionLease(String(payload.systemUserId), String(payload.organisationId), String(payload.leaseId), "EXPIRED");
  },
  "rent-obligation-status": async (payload: Record<string, unknown>) => {
    await processRentObligationStatuses(String(payload.organisationId));
  },
  "lease-expiry-reminders": async (payload: Record<string, unknown>) => {
    await scheduleExpiryReminders(String(payload.systemUserId), String(payload.organisationId));
  },
};
