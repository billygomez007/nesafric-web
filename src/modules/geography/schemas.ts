import { z } from "zod";

/** Client-safe geography schemas (no database imports), shared by forms, APIs and services. */
export const geoIdSchema = z.string().trim().min(2).max(80).regex(/^[A-Za-z0-9:_.-]+$/);

/**
 * The structured location a form or API sends alongside the legacy text fields. Ids are what the
 * person picked in the cascading selector; `manual` is "I can't find my area" (kept as text,
 * never verified). A pin is optional and never required.
 */
export const structuredLocationSchema = z.object({
  regionId: geoIdSchema.nullish(),
  districtId: geoIdSchema.nullish(),
  localityId: geoIdSchema.nullish(),
  manual: z.boolean().optional(),
  /** What the person typed when they could not find their area (or any extra description). */
  manualText: z.string().trim().max(300).nullish(),
  streetOrEstate: z.string().trim().max(150).nullish(),
  landmark: z.string().trim().max(200).nullish(),
  accessNotes: z.string().trim().max(500).nullish(),
  pin: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracyM: z.number().int().min(0).max(100_000).nullish(),
  }).strict().nullish(),
  /** Set by a review step the person completed (website review, WhatsApp confirm). */
  confirmed: z.boolean().optional(),
}).strict().superRefine((value, context) => {
  if (value.manual && (value.localityId)) context.addIssue({ code: "custom", path: ["localityId"], message: "Choose a locality or say you can't find it, not both." });
  if (value.manual && !value.manualText) context.addIssue({ code: "custom", path: ["manualText"], message: "Describe the area you couldn't find." });
  if (value.localityId && !value.districtId) context.addIssue({ code: "custom", path: ["districtId"], message: "Choose the district first." });
  if (value.districtId && !value.regionId) context.addIssue({ code: "custom", path: ["regionId"], message: "Choose the region first." });
});
export type StructuredLocationInput = z.infer<typeof structuredLocationSchema>;

export const coverageItemSchema = z.object({
  areaId: geoIdSchema.nullish(),
  localityId: geoIdSchema.nullish(),
  nationwide: z.boolean().optional(),
  categoryId: z.string().uuid().nullish(),
}).strict().refine((item) => [Boolean(item.areaId), Boolean(item.localityId), Boolean(item.nationwide)].filter(Boolean).length === 1, "Each coverage entry is one area, one locality, or the whole country.");
export const coverageSchema = z.object({ countryCode: z.string().length(2).transform((value) => value.toUpperCase()), items: z.array(coverageItemSchema).max(100) }).strict();
export type CoverageInput = z.infer<typeof coverageSchema>;
