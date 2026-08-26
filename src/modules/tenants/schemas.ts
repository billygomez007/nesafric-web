import { z } from "zod";

export const createTenantSchema = z.object({
  legalName: z.string().trim().min(2).max(200),
  preferredName: z.string().trim().max(100).optional(),
  email: z.string().trim().email().max(254).optional(),
  phone: z.string().trim().max(50).optional(),
  addressLine1: z.string().trim().max(250).optional(),
  city: z.string().trim().max(100).optional(),
  countryCode: z.string().length(2).toUpperCase().optional(),
  notes: z.string().trim().max(2000).optional(),
});

export const updateTenantSchema = createTenantSchema.omit({ legalName: true }).extend({
  legalName: z.string().trim().min(2).max(200).optional(),
}).refine((input) => Object.keys(input).length > 0, "At least one tenant field must be provided.");

export const communicationPreferencesSchema = z.object({
  communicationInAppAllowed: z.boolean(),
  communicationEmailAllowed: z.boolean(),
  communicationSmsAllowed: z.boolean(),
  communicationWhatsappAllowed: z.boolean(),
});
