import { Prisma } from "@/platform/database/generated/client";
import { db } from "@/platform/database/client";

/**
 * Exactly-once (as observed by the person) execution of irreversible business actions started from
 * WhatsApp: creating a listing, registration, lead, viewing or service request. The key is derived
 * from the inbound message that asked for the action, so a duplicate webhook, a re-run after a
 * crash or a repeated "yes" never creates a second record.
 *
 * - First run: a STARTED row is written, the action runs, the row becomes COMPLETED with its result.
 * - Repeat after completion: the stored result is returned without running anything.
 * - Repeat while STARTED and younger than `ACTION_STALE_MS`: the earlier run may still be in flight,
 *   so nothing runs; `ActionInDoubtError` makes the processor retry the message later (without
 *   consuming an attempt).
 * - Repeat while STARTED and older than `ACTION_STALE_MS`: no worker can still be running it (leases
 *   last 2 minutes, requests at most 60 seconds), so the caller's `reconcile` looks for the record
 *   the action would have created. Found → COMPLETED with that result. Not found → the action never
 *   committed, and it is run again. A crash therefore neither duplicates nor permanently suppresses.
 * - A run that threw is marked FAILED (its transaction rolled back) and the next attempt re-runs it.
 */
export const ACTION_STALE_MS = 5 * 60_000;

export class ActionInDoubtError extends Error {
  constructor(readonly actionKey: string) {
    super("An earlier attempt at this action may still be running.");
    this.name = "ActionInDoubtError";
  }
}

export type ActionOutcome<T> = { status: "completed"; resultId: string; result?: T; repeated: boolean };

/** Looks for the record a STARTED action would have created, given when it started. */
export type Reconcile = (startedAt: Date) => Promise<string | null>;

export async function runOnce<T>(
  actionKey: string,
  contactId: string,
  kind: string,
  perform: () => Promise<{ id: string; result?: T }>,
  reconcile: Reconcile,
  now = new Date(),
): Promise<ActionOutcome<T>> {
  const existing = await db.whatsAppAction.findUnique({ where: { actionKey } });
  if (existing?.status === "COMPLETED" && existing.resultId) return { status: "completed", resultId: existing.resultId, repeated: true };
  if (existing?.status === "STARTED") {
    if (now.getTime() - existing.createdAt.getTime() < ACTION_STALE_MS) throw new ActionInDoubtError(actionKey);
    const found = await reconcile(existing.createdAt);
    if (found) {
      await db.whatsAppAction.update({ where: { actionKey }, data: { status: "COMPLETED", resultId: found, completedAt: now, error: "Reconciled after an interrupted attempt." } });
      return { status: "completed", resultId: found, repeated: true };
    }
    // Proven not to have happened: run it again under the same key.
    const reclaimed = await db.whatsAppAction.updateMany({ where: { actionKey, status: "STARTED" }, data: { status: "FAILED", error: "Interrupted before completing; retried." } });
    if (!reclaimed.count) throw new ActionInDoubtError(actionKey);
  }
  try {
    if (existing) {
      // FAILED (or just reconciled as not-done): restart the clock so staleness is measured afresh.
      const reclaimed = await db.whatsAppAction.updateMany({ where: { actionKey, status: "FAILED" }, data: { status: "STARTED", error: null, createdAt: now } });
      if (!reclaimed.count) throw new ActionInDoubtError(actionKey);
    } else {
      await db.whatsAppAction.create({ data: { actionKey, contactId, kind, createdAt: now } });
    }
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ActionInDoubtError(actionKey);
    throw error;
  }
  try {
    const { id, result } = await perform();
    await db.whatsAppAction.update({ where: { actionKey }, data: { status: "COMPLETED", resultId: id, completedAt: new Date() } });
    return { status: "completed", resultId: id, result, repeated: false };
  } catch (error) {
    await db.whatsAppAction.update({ where: { actionKey }, data: { status: "FAILED", error: error instanceof Error ? error.name.slice(0, 100) : "Action failed." } });
    throw error;
  }
}

/** Completed actions of a kind for a contact, newest first (e.g. their inquiries for status checks). */
export async function completedActions(contactId: string, kinds: string[], take = 10) {
  return db.whatsAppAction.findMany({
    where: { contactId, kind: { in: kinds }, status: "COMPLETED", resultId: { not: null } },
    orderBy: { createdAt: "desc" },
    take,
  });
}

/**
 * Lower bound for "created by this attempt": the action row's start, less a margin for skew between
 * the application clock (which stamps the action) and the database clock (which stamps records).
 */
export const sinceStart = (startedAt: Date) => new Date(startedAt.getTime() - 30_000);
