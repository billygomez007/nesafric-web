import { Prisma } from "@/platform/database/generated/client";
import { db } from "@/platform/database/client";
import { PERMISSIONS, requirePermission } from "@/platform/authorization/permissions";
import { notFound } from "@/platform/errors";
import { enqueueJob } from "@/platform/jobs/runner";
import { recordIntegrationOutcome } from "@/modules/integrations/service";
import { calendarProviders, type CalendarProviderRegistry } from "./provider";
import { createCalendarEventSchema, updateCalendarEventSchema, calendarListQuerySchema } from "./schemas";

const json = (value: unknown) => value as Prisma.InputJsonValue;

async function record(organisationId: string, actorUserId: string | null, name: string, entityId: string, payload: Record<string, unknown> = {}) {
  await db.auditEvent.create({ data: { organisationId, actorUserId: actorUserId ?? undefined, action: name, entityType: "calendar_event", entityId, metadata: json(payload) } });
  await db.domainEvent.create({ data: { organisationId, name, aggregateType: "calendar_event", aggregateId: entityId, payload: json(payload) } });
}

function enqueueSync(organisationId: string, calendarEventId: string, updatedAt: Date) {
  return enqueueJob({
    organisationId,
    type: "calendar-sync",
    idempotencyKey: `calendar-sync:${calendarEventId}:${updatedAt.getTime()}`,
    payload: { organisationId, calendarEventId },
  });
}

export function listAvailableCalendarProviders(registry: CalendarProviderRegistry = calendarProviders) {
  return registry.list().map((adapter) => ({ key: adapter.key, displayName: adapter.displayName, available: adapter.isConfigured() }));
}

/**
 * Creates or updates the calendar event tied to a source record (item 6). Always succeeds
 * synchronously — external sync is queued as a background job and never blocks core scheduling.
 * Internal callers (viewing confirmation, move-in/out scheduling, inspections, work orders) call
 * this directly; it also backs the standalone calendar CRUD API.
 */
export async function upsertCalendarEvent(input: {
  organisationId: string;
  type: "VIEWING" | "MOVE_IN" | "MOVE_OUT" | "INSPECTION" | "MAINTENANCE_APPOINTMENT";
  sourceType: string;
  sourceId: string;
  title: string;
  description?: string | null;
  startAt: Date;
  endAt: Date;
  timezone: string;
  location?: string | null;
  attendees?: Array<{ name: string; email?: string; role?: string }>;
  providerKey?: string;
  actorUserId?: string | null;
}) {
  const providerKey = input.providerKey ?? "INTERNAL";
  const existing = await db.calendarEvent.findUnique({
    where: { organisationId_sourceType_sourceId_type: { organisationId: input.organisationId, sourceType: input.sourceType, sourceId: input.sourceId, type: input.type } },
  });
  const event = await db.calendarEvent.upsert({
    where: { organisationId_sourceType_sourceId_type: { organisationId: input.organisationId, sourceType: input.sourceType, sourceId: input.sourceId, type: input.type } },
    create: {
      organisationId: input.organisationId, type: input.type, sourceType: input.sourceType, sourceId: input.sourceId,
      title: input.title, description: input.description, startAt: input.startAt, endAt: input.endAt, timezone: input.timezone,
      location: input.location, attendees: json(input.attendees ?? []), providerKey, syncStatus: "PENDING",
      createdByUserId: input.actorUserId ?? undefined,
    },
    update: {
      title: input.title, description: input.description, startAt: input.startAt, endAt: input.endAt, timezone: input.timezone,
      location: input.location, attendees: json(input.attendees ?? []), status: "UPDATED", syncStatus: "PENDING",
    },
  });
  await record(input.organisationId, input.actorUserId ?? null, existing ? "calendar.event_updated" : "calendar.event_created", event.id, {
    type: input.type, sourceType: input.sourceType, sourceId: input.sourceId,
  });
  await enqueueSync(input.organisationId, event.id, event.updatedAt);
  return event;
}

export async function cancelCalendarEventBySource(organisationId: string, sourceType: string, sourceId: string, type: string, actorUserId: string | null) {
  const event = await db.calendarEvent.findFirst({ where: { organisationId, sourceType, sourceId, type: type as never } });
  if (!event || event.status === "CANCELLED") return event;
  const updated = await db.calendarEvent.update({ where: { id: event.id }, data: { status: "CANCELLED", cancelledAt: new Date(), syncStatus: "PENDING" } });
  await record(organisationId, actorUserId, "calendar.event_cancelled", event.id, { type, sourceType, sourceId });
  await enqueueSync(organisationId, event.id, updated.updatedAt);
  return updated;
}

/** Executed by the background job runner (`calendar-sync`); throwing lets the existing job retry/backoff/error-tracking apply unchanged. */
export async function syncCalendarEventJob(organisationId: string, calendarEventId: string) {
  const event = await db.calendarEvent.findFirst({ where: { id: calendarEventId, organisationId } });
  if (!event) return;
  const adapter = calendarProviders.get(event.providerKey);
  const adapterInput = {
    externalReference: event.id,
    title: event.title,
    description: event.description ?? undefined,
    startAt: event.startAt,
    endAt: event.endAt,
    timezone: event.timezone,
    location: event.location ?? undefined,
    attendees: Array.isArray(event.attendees) ? (event.attendees as Array<{ name: string; email?: string; role?: string }>) : [],
  };
  try {
    if (event.status === "CANCELLED") {
      if (event.providerEventId) await adapter.cancelEvent(event.providerEventId);
      await db.calendarEvent.update({ where: { id: event.id }, data: { syncStatus: "SYNCED", lastSyncError: null, lastSyncAttemptAt: new Date() } });
      await recordIntegrationOutcome(organisationId, "CALENDAR", adapter.key, "SUCCESS");
      return;
    }
    const result = event.providerEventId ? await adapter.updateEvent(event.providerEventId, adapterInput) : await adapter.createEvent(adapterInput);
    await db.calendarEvent.update({ where: { id: event.id }, data: { providerEventId: result.providerEventId, syncStatus: "SYNCED", lastSyncError: null, lastSyncAttemptAt: new Date() } });
    await recordIntegrationOutcome(organisationId, "CALENDAR", adapter.key, "SUCCESS");
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Calendar sync failed.";
    await db.calendarEvent.update({ where: { id: event.id }, data: { syncStatus: "FAILED", lastSyncError: reason, lastSyncAttemptAt: new Date() } });
    await recordIntegrationOutcome(organisationId, "CALENDAR", adapter.key, "FAILURE", reason);
    throw error;
  }
}

export async function createCalendarEvent(userId: string, organisationId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.calendarManage);
  const data = createCalendarEventSchema.parse(input);
  return upsertCalendarEvent({ organisationId, ...data, actorUserId: userId });
}

export async function updateCalendarEvent(userId: string, organisationId: string, calendarEventId: string, input: unknown) {
  await requirePermission(userId, organisationId, PERMISSIONS.calendarManage);
  const data = updateCalendarEventSchema.parse(input);
  const existing = await db.calendarEvent.findFirst({ where: { id: calendarEventId, organisationId } });
  if (!existing) throw notFound();
  const updated = await db.calendarEvent.update({
    where: { id: existing.id },
    data: {
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.startAt !== undefined ? { startAt: data.startAt } : {}),
      ...(data.endAt !== undefined ? { endAt: data.endAt } : {}),
      ...(data.timezone !== undefined ? { timezone: data.timezone } : {}),
      ...(data.location !== undefined ? { location: data.location } : {}),
      ...(data.attendees !== undefined ? { attendees: json(data.attendees) } : {}),
      status: "UPDATED",
      syncStatus: "PENDING",
    },
  });
  await record(organisationId, userId, "calendar.event_updated", updated.id, { type: updated.type });
  await enqueueSync(organisationId, updated.id, updated.updatedAt);
  return updated;
}

export async function cancelCalendarEvent(userId: string, organisationId: string, calendarEventId: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.calendarManage);
  const existing = await db.calendarEvent.findFirst({ where: { id: calendarEventId, organisationId } });
  if (!existing) throw notFound();
  return cancelCalendarEventBySource(organisationId, existing.sourceType, existing.sourceId, existing.type, userId);
}

export async function listCalendarEvents(userId: string, organisationId: string, query: unknown = {}) {
  await requirePermission(userId, organisationId, PERMISSIONS.calendarRead);
  const filters = calendarListQuerySchema.parse(query);
  const [items, total] = await Promise.all([
    db.calendarEvent.findMany({
      where: {
        organisationId,
        ...(filters.type ? { type: filters.type } : {}),
        ...(filters.sourceType ? { sourceType: filters.sourceType } : {}),
        ...(filters.sourceId ? { sourceId: filters.sourceId } : {}),
        ...(filters.from || filters.to ? { startAt: { gte: filters.from, lte: filters.to } } : {}),
      },
      orderBy: { startAt: "asc" },
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
    db.calendarEvent.count({
      where: {
        organisationId,
        ...(filters.type ? { type: filters.type } : {}),
        ...(filters.sourceType ? { sourceType: filters.sourceType } : {}),
        ...(filters.sourceId ? { sourceId: filters.sourceId } : {}),
        ...(filters.from || filters.to ? { startAt: { gte: filters.from, lte: filters.to } } : {}),
      },
    }),
  ]);
  return { items, pagination: { page: filters.page, pageSize: filters.pageSize, total, totalPages: Math.ceil(total / filters.pageSize) || 1 } };
}

export async function getCalendarEvent(userId: string, organisationId: string, calendarEventId: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.calendarRead);
  const event = await db.calendarEvent.findFirst({ where: { id: calendarEventId, organisationId } });
  if (!event) throw notFound();
  return event;
}
