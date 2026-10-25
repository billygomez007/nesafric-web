import { Prisma, type WhatsAppFlowDraft, type WhatsAppFlowKind } from "@/platform/database/generated/client";
import { db } from "@/platform/database/client";

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));

/** A draft not touched for this long expires; its canonical records (if any) are kept. */
export const DRAFT_LIFETIME_MS = 14 * 24 * 60 * 60_000;

export type FlowDraft = Omit<WhatsAppFlowDraft, "data"> & { data: Record<string, unknown> };

const asDraft = (row: WhatsAppFlowDraft): FlowDraft => ({ ...row, data: (row.data ?? {}) as Record<string, unknown> });
const isUniqueViolation = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

/** Marks this sender's lapsed drafts expired so they never block a new one. */
async function expireLapsed(address: string, userId: string) {
  await db.whatsAppFlowDraft.updateMany({ where: { address, userId, status: "OPEN", expiresAt: { lte: new Date() } }, data: { status: "EXPIRED" } });
}

/** The open draft of one kind for this sender and linked account, if any. */
export async function findOpenFlowDraft(address: string, userId: string, kind: WhatsAppFlowKind) {
  await expireLapsed(address, userId);
  const row = await db.whatsAppFlowDraft.findFirst({ where: { address, userId, kind, status: "OPEN" } });
  return row ? asDraft(row) : null;
}

/** Every open draft for this sender and linked account (for resume and photo routing). */
export async function listOpenFlowDrafts(address: string, userId: string) {
  await expireLapsed(address, userId);
  return (await db.whatsAppFlowDraft.findMany({ where: { address, userId, status: "OPEN" }, orderBy: { updatedAt: "desc" } })).map(asDraft);
}

export async function getFlowDraft(id: string, userId: string) {
  const row = await db.whatsAppFlowDraft.findFirst({ where: { id, userId } });
  return row ? asDraft(row) : null;
}

/**
 * Starts a draft, or returns the open one of the same kind: a redelivered "start" (or two
 * concurrent ones) never creates a second draft, enforced by a partial unique index.
 */
export async function startFlowDraft(input: { address: string; userId: string; kind: WhatsAppFlowKind; step: string; data: Record<string, unknown>; messageId: string; targets?: Partial<Pick<WhatsAppFlowDraft, "marketplaceProfessionalId" | "serviceProviderId" | "organisationId" | "listingId">> }) {
  const existing = await findOpenFlowDraft(input.address, input.userId, input.kind);
  if (existing) return { draft: existing, created: false };
  try {
    const row = await db.whatsAppFlowDraft.create({
      data: { address: input.address, userId: input.userId, kind: input.kind, step: input.step, data: json(input.data), lastMessageId: input.messageId, expiresAt: new Date(Date.now() + DRAFT_LIFETIME_MS), ...input.targets },
    });
    return { draft: asDraft(row), created: true };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const winner = await findOpenFlowDraft(input.address, input.userId, input.kind);
    if (!winner) throw error;
    return { draft: winner, created: false };
  }
}

export type DraftChange = { step?: string; data?: Record<string, unknown>; targets?: Partial<Pick<WhatsAppFlowDraft, "marketplaceProfessionalId" | "serviceProviderId" | "organisationId" | "listingId">> };

/**
 * Applies one message's change to a draft under a row lock. A message already applied (webhook
 * redelivery or a retried job) changes nothing and returns `replayed: true`. Every applied change
 * increments the revision and extends the draft's life. A draft no longer open is not changed.
 */
export async function applyFlowDraftChange(draftId: string, userId: string, messageId: string, change: (draft: FlowDraft) => Promise<DraftChange | null> | DraftChange | null) {
  return db.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw<WhatsAppFlowDraft[]>`SELECT * FROM "WhatsAppFlowDraft" WHERE "id" = ${draftId}::uuid AND "userId" = ${userId}::uuid FOR UPDATE`;
    if (!row || row.status !== "OPEN") return { draft: row ? asDraft(row) : null, replayed: false, applied: false };
    const draft = asDraft(row);
    if (row.lastMessageId === messageId) return { draft, replayed: true, applied: false };
    const next = await change(draft);
    if (!next) return { draft, replayed: false, applied: false };
    const updated = await tx.whatsAppFlowDraft.update({
      where: { id: draftId },
      data: {
        step: next.step ?? draft.step,
        data: json(next.data ?? draft.data),
        revision: { increment: 1 },
        lastMessageId: messageId,
        expiresAt: new Date(Date.now() + DRAFT_LIFETIME_MS),
        ...next.targets,
      },
    });
    return { draft: asDraft(updated), replayed: false, applied: true };
  });
}

/**
 * Claims a reviewed draft for submission: succeeds once, only while the draft is open, at the
 * step given and at the revision the person reviewed. A late or repeated confirmation, or one
 * made after the draft changed, gets `false`.
 */
export async function claimFlowDraftForSubmission(draftId: string, userId: string, step: string, reviewedRevision: number, messageId: string) {
  const claimed = await db.whatsAppFlowDraft.updateMany({
    where: { id: draftId, userId, status: "OPEN", step, revision: reviewedRevision },
    data: { step: "submitting", revision: { increment: 1 }, lastMessageId: messageId },
  });
  return claimed.count === 1;
}

/** Records the outcome of a claimed submission (targets created, step and status). */
export async function finishFlowDraft(draftId: string, change: { status?: "OPEN" | "SUBMITTED" | "CANCELLED"; step: string; data?: Record<string, unknown>; targets?: DraftChange["targets"] }) {
  const row = await db.whatsAppFlowDraft.update({
    where: { id: draftId },
    data: {
      step: change.step,
      ...(change.status ? { status: change.status } : {}),
      ...(change.status === "SUBMITTED" ? { submittedAt: new Date() } : {}),
      ...(change.data ? { data: json(change.data) } : {}),
      ...change.targets,
      revision: { increment: 1 },
    },
  });
  return asDraft(row);
}

export async function cancelFlowDraft(draftId: string, userId: string) {
  const result = await db.whatsAppFlowDraft.updateMany({ where: { id: draftId, userId, status: "OPEN" }, data: { status: "CANCELLED" } });
  return result.count === 1;
}

/** Expires every lapsed open draft (scheduled cleanup). */
export async function expireLapsedFlowDrafts(now = new Date()) {
  return (await db.whatsAppFlowDraft.updateMany({ where: { status: "OPEN", expiresAt: { lte: now } }, data: { status: "EXPIRED" } })).count;
}
