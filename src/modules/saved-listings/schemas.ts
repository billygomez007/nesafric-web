import { z } from "zod";

export const savedListingIdSchema = z.string().uuid();

export const savedListingsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
}).strict();

/** Merge of a device's saved list into the account (e.g. the mobile app on first sign-in). */
export const importSavedListingsSchema = z.object({
  listingIds: z.array(savedListingIdSchema).max(200),
}).strict();
