import type { Prisma } from "@/platform/database/generated/client";

/**
 * Transactional outbox for WhatsApp status notifications. Domain services call
 * `enqueueWhatsAppNotificationInTx` inside the transaction that makes the decision, so the
 * notification exists if and only if the decision committed: it can't roll a decision back (a
 * duplicate is skipped, never thrown) and can't silently disappear after it. Delivery happens right
 * after commit (`deliverWhatsAppNotificationNow`) and, if that fails or never runs, through the
 * background job runner, which retries. Deliberately free of imports so any service can use it.
 */
export const NOTIFY_JOB = "whatsapp-assistant-notify";

export type WhatsAppNotificationJob =
  | { kind: "listing_decision"; listingId: string; decision: "published" | "changes_requested" | "rejected"; note?: string | null; decisionKey: string }
  | { kind: "professional_verification"; professionalId: string; status: string; reason?: string | null; decisionKey: string }
  | { kind: "provider_identity"; providerId: string; status: string; reason?: string | null; decisionKey: string }
  | { kind: "viewing_update"; viewingRequestId: string; decisionKey: string }
  | { kind: "affiliation_claim"; agencyId: string; agentProfessionalId: string; decisionKey: string }
  | { kind: "provider_enquiry"; enquiryId: string; decisionKey: string };

export const notificationJobKey = (job: WhatsAppNotificationJob) => `wa-notify:${job.kind}:${job.decisionKey}`;

export async function enqueueWhatsAppNotificationInTx(tx: Prisma.TransactionClient, job: WhatsAppNotificationJob) {
  await tx.backgroundJob.createMany({
    data: [{ type: NOTIFY_JOB, idempotencyKey: notificationJobKey(job), payload: JSON.parse(JSON.stringify(job)), runAt: new Date(), maxAttempts: 5 }],
    skipDuplicates: true,
  });
  return job;
}

/** After commit: deliver now; on any failure the queued job retries. Never throws. */
export async function deliverWhatsAppNotificationNow(job: WhatsAppNotificationJob) {
  try {
    const { runWhatsAppNotification } = await import("./notifications");
    await runWhatsAppNotification(job);
    const { db } = await import("@/platform/database/client");
    await db.backgroundJob.updateMany({ where: { idempotencyKey: notificationJobKey(job), status: "PENDING" }, data: { status: "SUCCEEDED", completedAt: new Date() } });
  } catch (error) {
    console.error("[whatsapp-assistant] immediate notification failed; the queued job will retry", { kind: job.kind, error: error instanceof Error ? error.name : "unknown" });
  }
}
