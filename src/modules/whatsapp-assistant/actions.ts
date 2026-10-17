import { Prisma } from "@/platform/database/generated/client";
import { db } from "@/platform/database/client";

/**
 * At-most-once execution for irreversible business actions started from WhatsApp (creating a
 * listing, submitting a registration, sending an inquiry). The key is derived from the inbound
 * message that asked for the action, so a duplicate webhook, a retry after a crash or a repeated
 * "yes" can never create a second record.
 *
 * - First run: a STARTED row is written, the action runs, the row becomes COMPLETED with its result.
 * - Repeat after completion: the stored result is returned without running anything.
 * - Repeat while a previous run is STARTED (it crashed mid-way, outcome unknown): nothing runs;
 *   the caller tells the person it is being checked and support is alerted. Never a blind retry.
 * - A run that threw a known error is marked FAILED and may be attempted again with a new key.
 */
export type ActionOutcome<T> =
  | { status: "completed"; resultId: string; result?: T; repeated: boolean }
  | { status: "in_doubt" };

export async function runOnce<T>(
  actionKey: string,
  contactId: string,
  kind: string,
  perform: () => Promise<{ id: string; result?: T }>,
): Promise<ActionOutcome<T>> {
  const existing = await db.whatsAppAction.findUnique({ where: { actionKey } });
  if (existing?.status === "COMPLETED" && existing.resultId) return { status: "completed", resultId: existing.resultId, repeated: true };
  if (existing?.status === "STARTED") return { status: "in_doubt" };
  try {
    if (existing?.status === "FAILED") {
      const reclaimed = await db.whatsAppAction.updateMany({ where: { actionKey, status: "FAILED" }, data: { status: "STARTED", error: null } });
      if (!reclaimed.count) return { status: "in_doubt" };
    } else {
      await db.whatsAppAction.create({ data: { actionKey, contactId, kind } });
    }
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { status: "in_doubt" };
    throw error;
  }
  try {
    const { id, result } = await perform();
    await db.whatsAppAction.update({ where: { actionKey }, data: { status: "COMPLETED", resultId: id, completedAt: new Date() } });
    return { status: "completed", resultId: id, result, repeated: false };
  } catch (error) {
    await db.whatsAppAction.update({ where: { actionKey }, data: { status: "FAILED", error: error instanceof Error ? error.message.slice(0, 500) : "Action failed." } });
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
