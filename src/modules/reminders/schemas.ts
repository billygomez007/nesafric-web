import { z } from "zod";

const channels = z.array(z.enum(["IN_APP", "EMAIL", "SMS", "WHATSAPP"]))
  .min(1, "Choose at least one notification channel.")
  .refine((values) => new Set(values).size === values.length, "Notification channels must be unique.");

export const createReminderPolicySchema = z.object({
  daysOffset: z.coerce.number().int().min(0, "Days before expiry cannot be negative.").max(3650, "Days before expiry cannot exceed 3650."),
  channels,
  enabled: z.boolean().default(true),
});

export const updateReminderPolicySchema = createReminderPolicySchema.partial()
  .refine((input) => Object.keys(input).length > 0, "At least one reminder policy field must be provided.");

export const manualReminderSchema = z.object({
  leaseId: z.string().uuid(),
  tenantOrganisationId: z.string().uuid(),
  eventType: z.enum(["LEASE_EXPIRY", "RENT_OVERDUE"]),
  channel: z.enum(["IN_APP", "EMAIL", "SMS", "WHATSAPP"]).default("IN_APP"),
}).strict();
