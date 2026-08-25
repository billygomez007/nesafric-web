import { z } from "zod";

export const createOrganisationSchema = z.object({
  name: z.string().trim().min(2).max(160),
  type: z.enum(["INDIVIDUAL_LANDLORD", "PROPERTY_MANAGEMENT", "REAL_ESTATE", "DEVELOPER", "OTHER"]),
  countryCode: z.string().length(2).toUpperCase(),
  defaultCurrencyCode: z.string().length(3).toUpperCase().optional(),
});

export const inviteMemberSchema = z.object({
  email: z.string().trim().email(),
  roleKey: z.string().min(1).max(80),
});
