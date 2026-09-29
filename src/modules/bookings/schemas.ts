import { z } from "zod";

import { MAX_GUESTS } from "@/lib/listing-categories";

/** A calendar date ("2026-10-14"), as a guest picks it: no time and no time zone. */
const calendarDate = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date such as 2026-10-14.")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value), "That date doesn't exist.");

/**
 * A guest's booking request. Only what the guest actually decides is accepted: the listing comes
 * from the URL, and the recipient, category and price come from the listing on the server —
 * `.strict()` refuses any attempt to send them.
 */
export const createAccommodationBookingSchema = z.object({
  checkIn: calendarDate,
  checkOut: calendarDate,
  adults: z.number().int().min(1).max(MAX_GUESTS),
  children: z.number().int().min(0).max(MAX_GUESTS).default(0),
  name: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(320),
  phone: z.string().trim().min(5).max(50).optional(),
  specialRequest: z.string().trim().max(1_000).optional(),
}).strict();

export type CreateAccommodationBookingInput = z.infer<typeof createAccommodationBookingSchema>;

export const ACCOMMODATION_BOOKING_STATUSES = ["REQUESTED", "CONFIRMED", "DECLINED", "CANCELLED"] as const;

export const accommodationBookingListSchema = z.object({
  status: z.enum(ACCOMMODATION_BOOKING_STATUSES).optional(),
  listingId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
}).strict();

/** The operator's decision. A request can be confirmed or declined; a confirmed stay can be cancelled. */
export const updateAccommodationBookingStatusSchema = z.object({
  status: z.enum(["CONFIRMED", "DECLINED", "CANCELLED"]),
}).strict();
