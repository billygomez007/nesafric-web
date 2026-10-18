import { AppError } from "@/platform/errors";
import { db } from "@/platform/database/client";
import { getObjectStorageAdapter } from "@/platform/storage/registry";
import { uploadOrganisationDocument } from "@/modules/documents/service";
import { recordDispatchDecline } from "@/modules/maintenance-routing/dispatch";
import { manualDispatch, resolveEscalations, stopAutomation } from "@/modules/maintenance-routing/oversight";
import { acceptJob, askAboutJob, completeJob, decideQuote, findProviderJobs, formatMoney, proposeAppointment, startJob, submitQuote, tenantRespondToCompletion, verifyCompletion, type ProviderJob } from "@/modules/maintenance-routing/provider-actions";
import { downloadWhatsAppMedia } from "./maintenance/media";
import { parseAmountMinor } from "./onboarding/parse";
import type { AssistantState } from "./schemas";

type Linked = { user: { id: string; displayName: string } } | null;
type JobState = NonNullable<AssistantState["job"]>;
export type JobInput = { body: string; kind: string; messageId: string; media?: { id: string; mimeType?: string }; replyTo?: string };
export type JobResult = { state: AssistantState; reply: string; /** Stored with the outbound reply (e.g. redact after sending). */ replyMetadata?: Record<string, unknown> };

const REF = "(nm-\\d{4,})";
const PROVIDER = new RegExp(`^(accept|decline|start|done|photos|info|question|visit|appointment|quote)(?:\\s+${REF})?(?:\\s+(.+))?$`, "s");
const LANDLORD = new RegExp(`^(approve|reject|verify|stop|resolve)\\s+${REF}(?:\\s+(.+))?$`, "s");
const SEND = new RegExp(`^send\\s+${REF}\\s+to\\s+([1-9]\\d?)$`);
const TENANT = new RegExp(`^(ok|fixed|problem|not fixed)\\s+${REF}$`);

const describe = (job: ProviderJob) => {
  const request = job.workOrder.maintenanceRequest;
  const authorised = job.workOrder.authorizationMode === "PRE_AUTHORIZED" && job.workOrder.authorizedSpendMinor ? `Authorised: repair up to ${formatMoney(job.workOrder.authorizedSpendMinor, job.workOrder.currencyCode)}.` : job.workOrder.authorizationMode === "INSPECTION_ONLY" ? "Authorised: inspection only; send a quote for any paid work." : "Send a quote before any paid work.";
  return `${request.referenceNumber} for ${job.landlordOrganisation.name}: ${request.title}\n${request.property.name}${request.unit ? `, ${request.unit.name}` : ""}\nUrgency: ${request.priority.toLowerCase()}. Photos: ${request._count.attachments}.\n${authorised}`;
};
const COMMANDS = (reference: string) => `Reply: visit ${reference} 2026-12-20 14:00, quote ${reference} 450 what it covers, start ${reference}, done ${reference}, photos ${reference}, or info ${reference} your question.`;

/** The WhatsApp message a quick-reply button answered, mapped back to the dispatch attempt. */
async function assignmentForReply(replyTo: string | undefined) {
  if (!replyTo) return null;
  const delivery = await db.messageDelivery.findFirst({ where: { channel: "WHATSAPP", providerReference: replyTo }, include: { message: { select: { metadata: true } } } });
  const attemptId = (delivery?.message.metadata as { dispatchAttemptId?: unknown } | null)?.dispatchAttemptId;
  if (typeof attemptId !== "string") return null;
  return (await db.maintenanceDispatchAttempt.findUnique({ where: { id: attemptId }, select: { providerAssignmentId: true } }))?.providerAssignmentId ?? null;
}

async function attachEvidence(userId: string, job: ProviderJob, media: { id: string; mimeType?: string }) {
  const file = await downloadWhatsAppMedia(media.id).catch(() => null);
  if (!file) return false;
  const extension = file.contentType === "application/pdf" ? "pdf" : file.contentType.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
  return uploadOrganisationDocument(userId, job.landlordOrganisationId, { targetType: "MAINTENANCE_ATTACHMENT", targetId: job.workOrder.maintenanceRequestId, fileName: `completion-${media.id}.${extension}`, contentType: file.contentType, dataBase64: file.body.toString("base64") }).then(() => true, () => false);
}

/** Organisations where this user may make the decision, for a ticket reference. */
async function landlordRequest(userId: string, reference: string, permission: string) {
  const requests = await db.maintenanceRequest.findMany({ where: { referenceNumber: reference.toUpperCase(), organisation: { members: { some: { userId, status: "ACTIVE", archivedAt: null, roles: { some: { role: { permissions: { some: { permission: { key: permission } } } } } } } } } }, select: { id: true, organisationId: true, referenceNumber: true, title: true } });
  return requests.length === 1 ? requests[0] : null;
}

/**
 * Work-order replies and commands on the official number:
 * - providers act only on jobs assigned to provider profiles they own;
 * - landlords approve or reject quotes and verify completion, each read back first;
 * - tenants confirm or dispute a completed repair on their own request.
 * Returns null when the message is not for this flow.
 */
export async function advanceJobs(input: JobInput, linked: Linked, state: AssistantState, reset: () => AssistantState): Promise<JobResult | null> {
  const body = input.body.trim();
  const command = body.toLowerCase();
  const inFlow = state.workflow === "job" && state.job;
  if (!linked) return null;
  const userId = linked.user.id;

  if (inFlow) return continueFlow(input, userId, state.job!, state, reset);

  const tenant = TENANT.exec(command);
  if (tenant) {
    const request = await db.maintenanceRequest.findFirst({ where: { referenceNumber: tenant[2].toUpperCase(), tenantOrganisation: { userId } }, select: { id: true, organisationId: true } });
    if (!request) return { state, reply: `I could not find ${tenant[2].toUpperCase()} among your requests.` };
    try {
      const result = await tenantRespondToCompletion(userId, request.organisationId, request.id, tenant[1] === "ok" || tenant[1] === "fixed", input.messageId);
      return { state, reply: result.status === "CLOSED" ? "Thanks for confirming. The request is closed." : "Sorry it is not fixed. I have reopened the request and alerted your landlord." };
    } catch (error) {
      if (error instanceof AppError && error.status < 500) return { state, reply: error.message };
      throw error;
    }
  }

  // A person taking over: send the job to a chosen network provider (numbers from "providers").
  const send = SEND.exec(command);
  if (send) {
    const request = await landlordRequest(userId, send[1], "maintenance.assign");
    const entry = state.network?.listed[Number(send[2]) - 1];
    if (!request) return { state, reply: `You cannot dispatch ${send[1].toUpperCase()}, or it does not exist.` };
    if (!entry || entry.organisationId !== request.organisationId) return { state, reply: "Reply providers to see the numbered list first, then use those numbers." };
    return { state: { ...state, workflow: "job", job: { step: "confirm_decision", reference: request.referenceNumber!, photos: 0, decision: { kind: "send", organisationId: request.organisationId, requestId: request.id, providerOrganisationId: entry.id } } }, reply: `Please confirm: send ${request.referenceNumber} (${request.title}) to ${entry.name} yourself, instead of following your rules. They will be asked to quote before any paid work.\nReply confirm, or cancel.` };
  }

  const landlord = LANDLORD.exec(command);
  if (landlord) {
    const kind = landlord[1] as "approve" | "reject" | "verify" | "stop" | "resolve";
    const permission = kind === "approve" || kind === "reject" ? "maintenance.approve" : "maintenance.manage";
    const request = await landlordRequest(userId, landlord[2], permission);
    if (!request) return { state, reply: `You cannot ${kind} ${landlord[2].toUpperCase()}, or it does not exist.` };
    const pending = kind === "approve" || kind === "reject" ? await db.maintenanceApproval.findFirst({ where: { maintenanceRequestId: request.id, status: "PENDING" }, orderBy: { requestedAt: "desc" } }) : null;
    if ((kind === "approve" || kind === "reject") && !pending) return { state, reply: `There is no quote waiting for approval on ${request.referenceNumber}.` };
    const what = kind === "verify" ? `close ${request.referenceNumber} (${request.title}) as verified`
      : kind === "stop" ? `stop automatic handling of ${request.referenceNumber}. Any provider still being asked is told no, and no backup is tried`
      : kind === "resolve" ? `mark the alerts on ${request.referenceNumber} as handled`
      : `${kind} the quote of ${formatMoney(pending!.requestedAmountMinor, pending!.currencyCode)} on ${request.referenceNumber}${kind === "approve" ? `. The provider may then spend up to that amount` : ""}`;
    return { state: { ...state, workflow: "job", job: { step: "confirm_decision", reference: request.referenceNumber!, photos: 0, decision: { kind, organisationId: request.organisationId, requestId: request.id, reason: landlord[3]?.slice(0, 500), approvalId: pending?.id } } }, reply: `Please confirm: ${what}.\nReply confirm, or cancel.` };
  }

  const match = PROVIDER.exec(command);
  const replyAssignment = await assignmentForReply(input.replyTo);
  if (!match && !replyAssignment) return null;
  const action = match?.[1] ?? (/^(accept|yes)/.test(command) ? "accept" : /^(decline|no)/.test(command) ? "decline" : null);
  if (!action) return null;
  const reference = match?.[2]?.toUpperCase();
  const jobs = await findProviderJobs(userId, reference);
  // Without a reference or button context, an action needs exactly one open job, and invitation
  // answers (accept/decline with no job) are left to the invitation flow.
  const job = replyAssignment ? jobs.find((item) => item.id === replyAssignment) ?? (await findProviderJobs(userId)).find((item) => item.id === replyAssignment) : reference ? jobs[0] : jobs.length === 1 ? jobs[0] : undefined;
  if (!job) {
    if (!reference && !replyAssignment && (action === "accept" || action === "decline") && !jobs.length) return null;
    if (!jobs.length) return reference ? { state, reply: `${reference} is not one of your open jobs.` } : null;
    return { state, reply: `You have several open jobs. Add the reference, for example ${action} ${jobs[0].workOrder.maintenanceRequest.referenceNumber}.\n${jobs.map((item) => `• ${item.workOrder.maintenanceRequest.referenceNumber}: ${item.workOrder.maintenanceRequest.title}`).join("\n")}` };
  }
  const ref = job.workOrder.maintenanceRequest.referenceNumber!;
  const extra = match?.[3]?.trim();
  try {
    switch (action) {
      case "accept": {
        const accepted = await acceptJob(userId, job.id);
        return { state, reply: `Accepted.\n${describe(accepted)}\n${COMMANDS(ref)}` };
      }
      case "decline": {
        const attempt = await db.maintenanceDispatchAttempt.findFirst({ where: { providerAssignmentId: job.id } });
        if (attempt) await recordDispatchDecline(job.landlordOrganisationId, attempt.id, extra);
        else await db.providerAssignment.updateMany({ where: { id: job.id, status: "PENDING" }, data: { status: "DECLINED", respondedAt: new Date(), respondedByUserId: userId } });
        return { state, reply: `You declined ${ref}. Thank you for letting us know.` };
      }
      case "info":
      case "question": {
        if (!extra) return { state, reply: `Send your question after the reference, for example info ${ref} is there parking?` };
        await askAboutJob(userId, job.id, extra, input.messageId);
        return { state, reply: `Your question about ${ref} was sent to ${job.landlordOrganisation.name}.` };
      }
      case "visit":
      case "appointment": {
        const when = extra && /^(\d{4}-\d{2}-\d{2})[ t](\d{2}:\d{2})$/i.exec(extra);
        const startsAt = when ? new Date(`${when[1]}T${when[2]}:00Z`) : null;
        if (!startsAt || !Number.isFinite(startsAt.getTime())) return { state, reply: `Send the visit time as: visit ${ref} 2026-12-20 14:00 (Ghana time).` };
        await proposeAppointment(userId, job.id, startsAt);
        return { state, reply: `Visit for ${ref} noted for ${when![1]} ${when![2]}. The tenant has been told.` };
      }
      case "quote": {
        const [amountText, ...rest] = (extra ?? "").split(/\s+/);
        const amountMinor = amountText ? parseAmountMinor(amountText) : null;
        if (!amountMinor) return { state, reply: `Send the quote as: quote ${ref} 450 what it covers.` };
        const result = await submitQuote(userId, job.id, { amountMinor, note: rest.join(" ") || undefined });
        return { state, reply: result.approvalRequired ? `Quote for ${ref} sent for approval. Do not start paid work until you are told it is approved.` : `Quote for ${ref} is within what is authorised. You may go ahead.` };
      }
      case "start": {
        await startJob(userId, job.id);
        return { state, reply: `${ref} marked as in progress. Reply done ${ref} when finished.` };
      }
      case "photos": {
        const attachments = await db.maintenanceAttachment.findMany({ where: { maintenanceRequestId: job.workOrder.maintenanceRequestId }, take: 5, orderBy: { createdAt: "asc" } });
        if (job.status !== "ACCEPTED") return { state, reply: `Accept ${ref} first to see its photos.` };
        if (!attachments.length) return { state, reply: `${ref} has no photos.` };
        const adapter = getObjectStorageAdapter();
        const links = await Promise.all(attachments.map((attachment) => adapter.getSignedUrl(attachment.fileKey, "PRIVATE", { expiresInSeconds: 900 }).catch(() => null)));
        // The links are removed from the stored transcript as soon as the message is sent.
        return { state, reply: `Photos for ${ref} (links expire in 15 minutes):\n${links.filter(Boolean).join("\n")}`, replyMetadata: { redactAfterSend: `Photo links for ${ref} were sent (removed from the transcript).` } };
      }
      case "done": {
        if (job.status !== "ACCEPTED") return { state, reply: `Accept ${ref} first.` };
        return { state: { ...reset(), workflow: "job", job: { step: "work", assignmentId: job.id, reference: ref, photos: 0 } }, reply: `Completing ${ref}. What work did you do?` };
      }
    }
  } catch (error) {
    if (error instanceof AppError && error.status < 500) return { state, reply: error.message };
    throw error;
  }
  return null;
}

async function continueFlow(input: JobInput, userId: string, job: JobState, state: AssistantState, reset: () => AssistantState): Promise<JobResult> {
  const body = input.body.trim();
  const command = body.toLowerCase();
  if (command === "cancel" || command === "menu") return { state: reset(), reply: "Cancelled. Nothing was recorded." };
  const next = (patch: Partial<JobState>, reply: string): JobResult => ({ state: { ...state, job: { ...job, ...patch } }, reply });

  if (job.step === "confirm_decision") {
    if (command !== "confirm" || !job.decision) return { state, reply: "Reply confirm to go ahead, or cancel." };
    const { kind, organisationId, requestId, reason } = job.decision;
    try {
      if (kind === "verify") await verifyCompletion(userId, organisationId, requestId);
      else if (kind === "stop") await stopAutomation(userId, organisationId, requestId, reason ?? "Stopped on WhatsApp.");
      else if (kind === "resolve") await resolveEscalations(userId, organisationId, { requestId, note: reason });
      else if (kind === "send") await manualDispatch(userId, organisationId, requestId, { providerOrganisationId: job.decision.providerOrganisationId });
      else await decideQuote(userId, organisationId, requestId, kind === "approve", reason, job.decision.approvalId);
    } catch (error) {
      if (error instanceof AppError && error.status < 500) return { state: reset(), reply: `Not changed: ${error.message}` };
      throw error;
    }
    const done = { verify: `${job.reference} is closed.`, stop: `Automatic handling of ${job.reference} is stopped.`, resolve: `Alerts on ${job.reference} are marked as handled.`, send: `${job.reference} has been sent to the provider you chose.`, approve: `Quote approved on ${job.reference}. The provider has been told.`, reject: `Quote rejected on ${job.reference}. The provider has been told.` };
    return { state: reset(), reply: done[kind] };
  }

  const jobs = await findProviderJobs(userId, job.reference);
  const current = jobs.find((item) => item.id === job.assignmentId);
  if (!current) return { state: reset(), reply: `${job.reference} is no longer an open job for you.` };
  switch (job.step) {
    case "work":
      if (input.kind !== "text" || body.length < 3) return { state, reply: "Describe the work you did in a few words." };
      return next({ step: "cost", workPerformed: body.slice(0, 2000) }, "What did it cost in total? Send an amount, or 0 if nothing.");
    case "cost": {
      const costMinor = parseAmountMinor(body);
      if (!costMinor) return { state, reply: "Send the total as a number, for example 350, or 0." };
      return next({ step: "photos", costMinor }, "Send photos of the finished work (up to 5), or reply skip.");
    }
    case "photos": {
      if (input.kind === "image" || input.kind === "document") {
        if (!input.media || job.photos >= 5) return { state, reply: "Reply done to continue." };
        const saved = await attachEvidence(userId, current, input.media);
        return next({ photos: job.photos + (saved ? 1 : 0) }, saved ? `Photo ${job.photos + 1} saved. Send another, or reply done.` : "I could not save that file. Send another, or reply done.");
      }
      if (!["done", "skip", "no"].includes(command)) return { state, reply: "Send photos, or reply done." };
      return next({ step: "remaining" }, "Is anything still left to fix? Reply no, or describe it.");
    }
    case "remaining": {
      const remaining = ["no", "none", "nothing"].includes(command) ? undefined : body.slice(0, 1000);
      return next({ step: "confirm", remaining }, `Please confirm ${job.reference} is completed:\nWork: ${job.workPerformed}\nCost: ${formatMoney(BigInt(job.costMinor ?? "0"), current.workOrder.currencyCode)}\nPhotos: ${job.photos}\nStill to fix: ${remaining ?? "nothing"}\n\nReply confirm, or cancel.`);
    }
    case "confirm": {
      if (command !== "confirm") return { state, reply: "Reply confirm to record the job as completed, or cancel." };
      try {
        const result = await completeJob(userId, current.id, { workPerformed: job.workPerformed ?? "", actualCostMinor: job.costMinor ?? "0", remainingIssues: job.remaining, sourceMessageId: input.messageId });
        return { state: reset(), reply: `${job.reference} is recorded as completed${result.status === "COMPLETED" ? " and is waiting for verification" : ""}. Thank you.` };
      } catch (error) {
        if (error instanceof AppError && error.status < 500) return { state: reset(), reply: error.message };
        throw error;
      }
    }
  }
  return { state: reset(), reply: "Reply jobs to see your jobs." };
}
