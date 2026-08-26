import { z } from "zod";

export const integrationTypeSchema = z.enum(["STORAGE", "ESIGNATURE", "GEOCODING", "CALENDAR", "MALWARE_SCAN"]);

export const upsertIntegrationConfigSchema = z.object({
  integrationType: integrationTypeSchema,
  enabled: z.boolean(),
  /** Non-secret operational metadata only (e.g. a bucket name/region). Never accepts API keys or tokens — those stay env-only. */
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
}).strict();
