import { z } from "zod";

const id = z.string().uuid();
const optionalText = (max: number) => z.string().trim().min(1).max(max).nullable().optional();

export const calendarEventTypeSchema = z.enum(["VIEWING", "MOVE_IN", "MOVE_OUT", "INSPECTION", "MAINTENANCE_APPOINTMENT"]);

export const createCalendarEventSchema = z.object({
  type: calendarEventTypeSchema,
  sourceType: z.string().trim().min(1).max(100),
  sourceId: id,
  title: z.string().trim().min(1).max(200),
  description: optionalText(2_000),
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
  timezone: z.string().trim().min(1).max(100).default("Africa/Accra"),
  location: optionalText(300),
  attendees: z.array(z.object({ name: z.string().trim().min(1).max(160), email: z.string().trim().email().max(320).optional(), role: z.string().trim().max(80).optional() }).strict()).max(50).default([]),
  providerKey: z.string().trim().min(1).max(50).default("INTERNAL"),
}).strict().refine((value) => value.endAt > value.startAt, { path: ["endAt"], message: "The event must end after it starts." });

export const updateCalendarEventSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: optionalText(2_000),
  startAt: z.coerce.date().optional(),
  endAt: z.coerce.date().optional(),
  timezone: z.string().trim().min(1).max(100).optional(),
  location: optionalText(300),
  attendees: z.array(z.object({ name: z.string().trim().min(1).max(160), email: z.string().trim().email().max(320).optional(), role: z.string().trim().max(80).optional() }).strict()).max(50).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required.");

export const calendarListQuerySchema = z.object({
  type: calendarEventTypeSchema.optional(),
  sourceType: z.string().trim().min(1).max(100).optional(),
  sourceId: id.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
