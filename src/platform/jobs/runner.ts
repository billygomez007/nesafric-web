import { db } from "@/platform/database/client";
import { PERMISSIONS, requirePermission } from "@/platform/authorization/permissions";
import { AppError, notFound } from "@/platform/errors";
import type { BackgroundJob } from "@/platform/database/generated/client";
import { NonRetryableJobError } from "./errors";

/** Exponential backoff for messaging jobs, a flat minute for everything else. */
function retryDelayMs(job: BackgroundJob) {
  return job.type.startsWith("whatsapp-") || job.type === "conversation-message-delivery" ? Math.min(60_000 * 2 ** job.attempts, 3_600_000) : 60_000;
}

/** `job` is the row as read before the claim, so this attempt is number `job.attempts + 1`. */
function failureUpdate(job: BackgroundJob, error: unknown) {
  const lastError = error instanceof Error ? error.message : "Unknown job failure";
  if (error instanceof NonRetryableJobError || job.attempts + 1 >= job.maxAttempts) {
    return { status: "DEAD_LETTER" as const, lockedAt: null, lastError };
  }
  return { status: "FAILED" as const, lastError, runAt: new Date(Date.now() + retryDelayMs(job)) };
}

export async function enqueueJob(input: { organisationId?: string; type: string; idempotencyKey: string; payload: object; runAt?: Date; maxAttempts?: number }) {
  return db.backgroundJob.upsert({
    where: { idempotencyKey: input.idempotencyKey },
    update: {},
    create: { ...input, payload: input.payload, runAt: input.runAt ?? new Date(), maxAttempts: input.maxAttempts ?? 3 },
  });
}

export async function runDueJobs(
  handlers: Record<string, (payload: Record<string, unknown>) => Promise<void>>,
  now = new Date(),
) {
  // These handlers persist idempotency keys at their domain boundaries. Recover only
  // their expired claims; other job types need their own replay-safety assessment.
  await db.backgroundJob.updateMany({
    where: { status: "RUNNING", type: { in: ["whatsapp-assistant-message", "whatsapp-delivery-status", "whatsapp-legacy-inbound", "conversation-message-delivery"] }, lockedAt: { lt: new Date(now.getTime() - 5 * 60_000) } },
    data: { status: "FAILED", lockedAt: null, runAt: now, lastError: "Worker lease expired; retry with persisted idempotency keys. Unconfirmed sends require review." },
  });
  await db.backgroundJob.updateMany({
    where: { status: "FAILED", attempts: { gte: db.backgroundJob.fields.maxAttempts } },
    data: { status: "DEAD_LETTER" },
  });
  const eligible = await db.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "BackgroundJob"
    WHERE "status" IN ('PENDING', 'FAILED')
      AND "runAt" <= ${now}
      AND "attempts" < "maxAttempts"
    ORDER BY "runAt" ASC
    LIMIT 50
  `;

  const jobsById = new Map(
    (
      await db.backgroundJob.findMany({
        where: { id: { in: eligible.map(({ id }) => id) } },
      })
    ).map((job) => [job.id, job]),
  );

  const jobs = eligible.flatMap(({ id }) => jobsById.get(id) ?? []);

  let succeeded = 0;
  let failed = 0;

  for (const job of jobs) {
    const claimed = await db.backgroundJob.updateMany({
      where: {
        id: job.id,
        status: { in: ["PENDING", "FAILED"] },
      },
      data: {
        status: "RUNNING",
        lockedAt: now,
        attempts: { increment: 1 },
      },
    });

    if (!claimed.count) continue;

    try {
      const handler = handlers[job.type];
      if (!handler) throw new Error(`No handler registered for ${job.type}.`);

      const payload = job.payload as Record<string, unknown>;

      if (
        job.organisationId &&
        payload.organisationId !== job.organisationId
      ) {
        throw new Error(
          `Job organisation ${job.organisationId} does not match its payload organisation.`,
        );
      }

      await handler(payload);

      await db.backgroundJob.update({
        where: { id: job.id },
        data: {
          status: "SUCCEEDED",
          completedAt: new Date(),
          lastError: null,
        },
      });

      succeeded += 1;
    } catch (error) {
      await db.backgroundJob.update({ where: { id: job.id }, data: failureUpdate(job, error) });

      failed += 1;
    }
  }

  return {
    claimed: jobs.length,
    succeeded,
    failed,
  };
}

export async function runPendingJobs(
  handlers: Record<string, (payload: Record<string, unknown>) => Promise<void>>,
  now = new Date(),
) {
  const eligible = await db.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "BackgroundJob"
    WHERE "status" = 'PENDING'
      AND "runAt" <= ${now}
      AND "attempts" < "maxAttempts"
    ORDER BY "runAt" ASC
    LIMIT 50
  `;

  const jobsById = new Map(
    (
      await db.backgroundJob.findMany({
        where: { id: { in: eligible.map(({ id }) => id) } },
      })
    ).map((job) => [job.id, job]),
  );

  const jobs = eligible.flatMap(({ id }) => jobsById.get(id) ?? []);

  let succeeded = 0;
  let failed = 0;

  for (const job of jobs) {
    const claimed = await db.backgroundJob.updateMany({
      where: {
        id: job.id,
        status: "PENDING",
      },
      data: {
        status: "RUNNING",
        lockedAt: now,
        attempts: { increment: 1 },
      },
    });

    if (!claimed.count) continue;

    try {
      const handler = handlers[job.type];
      if (!handler) throw new Error(`No handler registered for ${job.type}.`);

      const payload = job.payload as Record<string, unknown>;

      if (
        job.organisationId &&
        payload.organisationId !== job.organisationId
      ) {
        throw new Error(
          `Job organisation ${job.organisationId} does not match its payload organisation.`,
        );
      }

      await handler(payload);

      await db.backgroundJob.update({
        where: { id: job.id },
        data: {
          status: "SUCCEEDED",
          completedAt: new Date(),
          lastError: null,
        },
      });

      succeeded += 1;
    } catch (error) {
      await db.backgroundJob.update({ where: { id: job.id }, data: failureUpdate(job, error) });

      failed += 1;
    }
  }

  return {
    claimed: jobs.length,
    succeeded,
    failed,
  };
}

export async function retryBackgroundJob(userId: string, organisationId: string, jobId: string) {
  await requirePermission(userId, organisationId, PERMISSIONS.jobRetry);
  const job = await db.backgroundJob.findFirst({ where: { id: jobId, organisationId } });
  if (!job) throw notFound();
  const deadLetter = job.status === "DEAD_LETTER";
  if (!deadLetter && (job.status !== "FAILED" || job.attempts >= job.maxAttempts)) {
    throw new AppError("JOB_NOT_RETRYABLE", 409, "This background job is not eligible for retry.");
  }
  return db.$transaction(async (tx) => {
    // A dead-lettered job gets exactly one more attempt per operator request.
    const updated = await tx.backgroundJob.update({
      where: { id: job.id },
      data: { runAt: new Date(), lockedAt: null, lastError: null, ...(deadLetter ? { status: "FAILED" as const, maxAttempts: job.attempts + 1 } : {}) },
    });
    await tx.auditEvent.create({ data: { organisationId, actorUserId: userId, action: "background_job.retry_requested", entityType: "background_job", entityId: job.id, metadata: { type: job.type, attempts: job.attempts, maxAttempts: job.maxAttempts } } });
    await tx.domainEvent.create({ data: { organisationId, name: "background_job.retry_requested", aggregateType: "background_job", aggregateId: job.id, payload: { type: job.type, attempts: job.attempts } } });
    return updated;
  });
}
