import { db } from "@/platform/database/client";

export async function enqueueJob(input: { organisationId?: string; type: string; idempotencyKey: string; payload: object; runAt?: Date; maxAttempts?: number }) {
  return db.backgroundJob.upsert({
    where: { idempotencyKey: input.idempotencyKey },
    update: {},
    create: { ...input, payload: input.payload, runAt: input.runAt ?? new Date(), maxAttempts: input.maxAttempts ?? 3 },
  });
}

export async function runDueJobs(handlers: Record<string, (payload: Record<string, unknown>) => Promise<void>>, now = new Date()) {
  const jobs = await db.backgroundJob.findMany({ where: { status: { in: ["PENDING", "FAILED"] }, runAt: { lte: now }, attempts: { lt: 3 } }, orderBy: { runAt: "asc" }, take: 50 });
  for (const job of jobs) {
    const claimed = await db.backgroundJob.updateMany({ where: { id: job.id, status: { in: ["PENDING", "FAILED"] } }, data: { status: "RUNNING", lockedAt: now, attempts: { increment: 1 } } });
    if (!claimed.count) continue;
    try {
      const handler = handlers[job.type];
      if (!handler) throw new Error(`No handler registered for ${job.type}.`);
      await handler(job.payload as Record<string, unknown>);
      await db.backgroundJob.update({ where: { id: job.id }, data: { status: "SUCCEEDED", completedAt: new Date(), lastError: null } });
    } catch (error) {
      await db.backgroundJob.update({ where: { id: job.id }, data: { status: "FAILED", lastError: error instanceof Error ? error.message : "Unknown job failure", runAt: new Date(Date.now() + 60_000) } });
    }
  }
}
