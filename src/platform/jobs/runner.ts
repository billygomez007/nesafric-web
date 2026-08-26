import { db } from "@/platform/database/client";
import { PERMISSIONS, requirePermission } from "@/platform/authorization/permissions";
import { AppError, notFound } from "@/platform/errors";

export async function enqueueJob(input: { organisationId?: string; type: string; idempotencyKey: string; payload: object; runAt?: Date; maxAttempts?: number }) {
  return db.backgroundJob.upsert({
    where: { idempotencyKey: input.idempotencyKey },
    update: {},
    create: { ...input, payload: input.payload, runAt: input.runAt ?? new Date(), maxAttempts: input.maxAttempts ?? 3 },
  });
}

export async function runDueJobs(handlers: Record<string, (payload: Record<string, unknown>) => Promise<void>>, now = new Date()) {
  const eligible = await db.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "BackgroundJob"
    WHERE "status" IN ('PENDING', 'FAILED')
      AND "runAt" <= ${now}
      AND "attempts" < "maxAttempts"
    ORDER BY "runAt" ASC
    LIMIT 50
  `;
  const jobsById = new Map((await db.backgroundJob.findMany({ where: { id: { in: eligible.map(({ id }) => id) } } }))
    .map((job) => [job.id, job]));
  const jobs = eligible.flatMap(({ id }) => jobsById.get(id) ?? []);
  for (const job of jobs) {
    const claimed = await db.backgroundJob.updateMany({ where: { id: job.id, status: { in: ["PENDING", "FAILED"] } }, data: { status: "RUNNING", lockedAt: now, attempts: { increment: 1 } } });
    if (!claimed.count) continue;
    try {
      const handler = handlers[job.type];
      if (!handler) throw new Error(`No handler registered for ${job.type}.`);
      const payload = job.payload as Record<string, unknown>;
      if (job.organisationId && payload.organisationId !== job.organisationId) {
        throw new Error(`Job organisation ${job.organisationId} does not match its payload organisation.`);
      }
      await handler(payload);
      await db.backgroundJob.update({ where: { id: job.id }, data: { status: "SUCCEEDED", completedAt: new Date(), lastError: null } });
    } catch (error) {
      await db.backgroundJob.update({ where: { id: job.id }, data: { status: "FAILED", lastError: error instanceof Error ? error.message : "Unknown job failure", runAt: new Date(Date.now() + 60_000) } });
    }
  }
}

export async function retryBackgroundJob(userId: string, organisationId: string, jobId: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.jobRetry);
  const job = await db.backgroundJob.findFirst({ where: { id: jobId, organisationId } });
  if (!job) throw notFound();
  if (job.status !== "FAILED" || job.attempts >= job.maxAttempts) {
    throw new AppError("JOB_NOT_RETRYABLE", 409, "This background job is not eligible for retry.");
  }
  return db.$transaction(async (tx) => {
    const updated = await tx.backgroundJob.update({
      where: { id: job.id },
      data: { runAt: new Date(), lockedAt: null, lastError: null },
    });
    await tx.auditEvent.create({ data: { organisationId, actorUserId: userId, action: "background_job.retry_requested", entityType: "background_job", entityId: job.id, metadata: { type: job.type, attempts: job.attempts, maxAttempts: job.maxAttempts } } });
    await tx.domainEvent.create({ data: { organisationId, name: "background_job.retry_requested", aggregateType: "background_job", aggregateId: job.id, payload: { type: job.type, attempts: job.attempts } } });
    return updated;
  });
}
