import { z } from "zod";

const id = z.string().uuid();

export const proposeDispatchSchema = z.object({
  workOrderId: id,
  allowMarketplaceFallback: z.boolean().default(false),
}).strict();

export const recordProviderResponseSchema = z.object({
  status: z.enum(["CONTACTED", "ACCEPTED", "DECLINED", "NO_RESPONSE"]),
  notes: z.string().trim().max(2_000).optional(),
}).strict();
