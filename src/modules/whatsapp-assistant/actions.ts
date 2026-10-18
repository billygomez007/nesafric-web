import type { Prisma } from "@/platform/database/generated/client";
import { db } from "@/platform/database/client";

/**
 * Exactly-once business actions started from WhatsApp (create a listing, a registration, a lead, a
 * viewing or service request, attach a photo…), enforced by the database rather than inferred.
 *
 * Each action has an exact key derived from the inbound message that asked for it. The domain
 * service creating the record calls `bind(tx, id)` inside its own transaction, which inserts the
 * `WhatsAppAction` row (`actionKey` is UNIQUE) and runs the workflow's follow-up writes (source
 * channel, events, outbox notifications) in that same transaction. So:
 *
 * - The binding exists if and only if the record and all its follow-ups committed.
 * - A competing or stale attempt that also creates a record fails on the unique key, and its whole
 *   transaction — record included — rolls back. It can never create a duplicate or overwrite the
 *   result of another attempt (bindings are insert-only).
 * - An exception is never taken to mean "nothing happened": after any failure the binding is read
 *   back. Present → the action committed (e.g. the acknowledgement was lost) and its original result
 *   is returned. Absent → the transaction did not commit, so re-running under the same key is safe
 *   and the original error is rethrown for the processor to retry or refuse.
 */
export type FollowUps = (tx: Prisma.TransactionClient, resultId: string) => Promise<void>;
/** The hook passed to a domain service's `inTransaction` option. */
export type Bind = (tx: Prisma.TransactionClient, record: { id: string }) => Promise<void>;

export type ActionOutcome = { resultId: string; repeated: boolean };

/** Test seam: lets regression tests inject a failure at a precise point of an action. */
export type ActionFaultStage = "after_record" | "after_follow_ups" | "after_commit";
let faultInjector: ((stage: ActionFaultStage, actionKey: string) => void | Promise<void>) | null = null;
export function setActionFaultInjector(injector: typeof faultInjector) {
  faultInjector = injector;
}

export async function boundResult(actionKey: string) {
  return (await db.whatsAppAction.findUnique({ where: { actionKey }, select: { resultId: true } }))?.resultId ?? null;
}

export async function runOnce(
  actionKey: string,
  contactId: string,
  kind: string,
  perform: (bind: (followUps?: FollowUps) => Bind) => Promise<unknown>,
): Promise<ActionOutcome> {
  const existing = await boundResult(actionKey);
  if (existing) return { resultId: existing, repeated: true };
  let boundId: string | null = null;
  const bind = (followUps?: FollowUps): Bind => async (tx, { id }) => {
    await faultInjector?.("after_record", actionKey);
    await tx.whatsAppAction.create({ data: { actionKey, contactId, kind, resultId: id } });
    await followUps?.(tx, id);
    await faultInjector?.("after_follow_ups", actionKey);
    boundId = id;
  };
  try {
    await perform(bind);
    if (!boundId) throw new Error(`Action ${kind} completed without binding its result.`);
    await faultInjector?.("after_commit", actionKey);
    return { resultId: boundId, repeated: false };
  } catch (error) {
    // Uncertain outcome: only the committed binding says whether the record exists.
    const committed = await boundResult(actionKey);
    if (committed) return { resultId: committed, repeated: true };
    // Not committed (a competing attempt that lost the unique key lands here too, after the
    // winner's commit made its binding visible above): safe to retry under the same key.
    throw error;
  }
}

/** The records a contact's actions of these kinds created, newest first (e.g. for status checks). */
export async function boundActions(contactId: string, kinds: string[], take = 10) {
  return db.whatsAppAction.findMany({ where: { contactId, kind: { in: kinds } }, orderBy: { createdAt: "desc" }, take });
}
