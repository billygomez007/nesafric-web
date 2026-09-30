import { z } from "zod";

const notificationPreferencesSchema = z.object({
  inquiryNotifications: z.boolean().optional(),
  viewingNotifications: z.boolean().optional(),
  leadNotifications: z.boolean().optional(),
  savedPropertyNotifications: z.boolean().optional(),
  bookingNotifications: z.boolean().optional(),
  serviceRequestNotifications: z.boolean().optional(),
  messageNotifications: z.boolean().optional(),
  reviewNotifications: z.boolean().optional(),
  accountActivityNotifications: z.boolean().optional(),
});

export const businessWhatsAppConfigInputSchema = notificationPreferencesSchema.extend({
  whatsappNumber: z.string().trim().min(1).max(32),
  whatsappOptIn: z.boolean(),
});

export const businessWhatsAppPreferencesInputSchema =
  notificationPreferencesSchema.refine(
    (value) => Object.keys(value).length > 0,
    "At least one notification preference must be supplied.",
  );

export type BusinessWhatsAppConfigInput = z.infer<
  typeof businessWhatsAppConfigInputSchema
>;

export type BusinessWhatsAppPreferencesInput = z.infer<
  typeof businessWhatsAppPreferencesInputSchema
>;
