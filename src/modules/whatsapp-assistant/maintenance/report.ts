import { db } from "@/platform/database/client";
import { AppError } from "@/platform/errors";
import type { MaintenanceStatus } from "@/platform/database/generated/client";
import { addTenantMaintenanceDetails, createMaintenanceRequest, getTenantMaintenanceHistory } from "@/modules/maintenance/service";
import { uploadOrganisationDocument } from "@/modules/documents/service";
import { listUserTenancies } from "@/modules/tenants/self-service";
import { redeemTenantAccessCode } from "@/modules/tenants/access-invitations";
import { replyButtons, type WhatsAppInteractive } from "@/modules/conversations/channels/whatsapp-interactive";
import type { AssistantState } from "../schemas";
import { classifyReport, looksLikeMaintenance } from "./classify";
import { downloadWhatsAppMedia } from "./media";

type ReportState = NonNullable<AssistantState["report"]>;
type Choice = ReportState["choices"][number];
type Linked = { user: { id: string; displayName: string } } | null;
export type ReportInput = { body: string; kind: string; messageId: string; media?: { id: string; mimeType?: string } };
export type ReportResult = { state: AssistantState; reply: string; redactInbound?: boolean; /** Reply buttons sent with `reply` as their fallback text. */ interactive?: WhatsAppInteractive };

const OPEN: MaintenanceStatus[] = ["REPORTED", "TRIAGED", "AWAITING_APPROVAL", "APPROVED", "ASSIGNED", "IN_PROGRESS"];
const STATUS_TEXT: Record<string, string> = { REPORTED: "received", TRIAGED: "being reviewed", AWAITING_APPROVAL: "waiting for landlord approval", APPROVED: "approved", ASSIGNED: "assigned to a provider", IN_PROGRESS: "in progress", COMPLETED: "completed", CLOSED: "closed", REJECTED: "declined", CANCELLED: "cancelled" };
const PRIORITY_TEXT = { EMERGENCY: "emergency", URGENT: "urgent", NORMAL: "normal", LOW: "low" } as const;
const START = /^(report|report a problem|report an issue|report repair|maintenance|repair|repairs|fix|new request)$/;
const ACCESS_CODE = /^NT-?[A-Z0-9]{5}(-?[A-Z0-9]{5}){3}$/i;
const MAX_PHOTOS = 5;
const SAFETY_ADVICE = "If anyone is in danger, move to safety and call emergency services on 112. Turn off power or water at the mains if it is safe to do so.";

const label = (choice: Choice) => `${choice.propertyName}${choice.unitName ? `, ${choice.unitName}` : ""} (${choice.organisationName})`;
const categoryText = (category: string) => category.charAt(0).toUpperCase() + category.slice(1);

/** Active tenancies proven for this account: a tenancy the landlord linked to it, with an active or expiring lease. */
async function tenancyChoices(userId: string): Promise<Choice[]> {
  const tenancies = await listUserTenancies(userId);
  return tenancies.flatMap((tenancy) => tenancy.leases.map((lease) => ({
    tenantOrganisationId: tenancy.tenantOrganisationId, organisationId: tenancy.organisation.id, organisationName: tenancy.organisation.name,
    propertyId: lease.property.id, propertyName: lease.property.name, unitId: lease.unit?.id, unitName: lease.unit?.name,
  }))).slice(0, 9);
}

/** Reply buttons whose ids are the commands this flow already handles. */
const ask = (state: AssistantState, reply: string, buttons: Array<{ id: string; title: string }>): ReportResult => ({ state, reply, interactive: replyButtons(reply, buttons) });
const SKIP = [{ id: "skip", title: "Skip photos" }];
const DONE = [{ id: "done", title: "Done" }];
const SAME_OR_NEW = [{ id: "same", title: "Same problem" }, { id: "new", title: "New problem" }];
const CONFIRM = [{ id: "confirm", title: "Confirm" }, { id: "edit", title: "Edit" }, { id: "cancel", title: "Cancel" }];
const CONFIRM_OR_CANCEL = CONFIRM.filter((button) => button.id !== "edit");
const photosPrompt = `Thanks. Send up to ${MAX_PHOTOS} photos of the problem now, or reply skip.`;

const notLinkedReply = "To report a repair, first connect this WhatsApp number to your NesAfric account: reply link. If you do not have an account yet, ask your landlord for your tenant access code.";
const noTenancyReply = "No active tenancy is connected to your account yet. If your landlord gave you a tenant access code (it starts with NT-), send it here.";

async function requestsReply(userId: string, choices: Choice[], reference?: string) {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const choice of choices) {
    if (seen.has(choice.tenantOrganisationId)) continue;
    seen.add(choice.tenantOrganisationId);
    const requests = await getTenantMaintenanceHistory(userId, choice.organisationId, choice.tenantOrganisationId) as Array<{ referenceNumber: string | null; title: string; status: string; property: { name: string }; unit: { name: string } | null }>;
    for (const request of requests) {
      if (reference && request.referenceNumber?.toUpperCase() !== reference) continue;
      lines.push(`${request.referenceNumber ?? "—"}: ${request.title} at ${request.property.name}${request.unit ? `, ${request.unit.name}` : ""} — ${STATUS_TEXT[request.status] ?? request.status.toLowerCase()}`);
    }
  }
  if (reference && !lines.length) return `I could not find ${reference} among your requests.`;
  return lines.length ? `Your maintenance requests:\n${lines.slice(0, 10).join("\n")}` : "You have no maintenance requests yet. Reply report to report a problem.";
}

async function describeStep(input: ReportInput, report: ReportState, state: AssistantState): Promise<ReportResult> {
  const description = [report.description, input.kind === "text" ? input.body.trim() : null].filter(Boolean).join("\n").slice(0, 4000);
  if (description.length < 5) return { state: { ...state, report: { ...report, step: "describe" } }, reply: "Please describe the problem: what is wrong, where in the home, and since when." };
  return ask({ ...state, report: { ...report, description, step: "photos" } }, photosPrompt, SKIP);
}

async function toConfirm(report: ReportState, state: AssistantState): Promise<ReportResult> {
  const choice = report.choices[report.selected ?? 0];
  const classification = await classifyReport(report.description ?? "");
  const duplicate = await db.maintenanceRequest.findFirst({
    where: {
      organisationId: choice.organisationId, tenantOrganisationId: choice.tenantOrganisationId, category: classification.category, status: { in: OPEN },
      createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) }, ...(choice.unitId ? { unitId: choice.unitId } : { propertyId: choice.propertyId }),
    },
    select: { id: true, referenceNumber: true, title: true, status: true },
    orderBy: { createdAt: "desc" },
  });
  const next = { ...report, classification };
  if (duplicate?.referenceNumber) {
    return ask(
      { ...state, report: { ...next, step: "duplicate", duplicate: { id: duplicate.id, referenceNumber: duplicate.referenceNumber, title: duplicate.title } } },
      `You already have an open request ${duplicate.referenceNumber}: "${duplicate.title}" (${STATUS_TEXT[duplicate.status]}). Is this the same problem?\nReply same to add these details to it, or new to report a separate problem.`,
      SAME_OR_NEW,
    );
  }
  return ask({ ...state, report: { ...next, step: "confirm", duplicate: undefined } }, confirmText(next, choice), CONFIRM);
}

function confirmText(report: ReportState, choice: Choice) {
  const classification = report.classification!;
  return [
    `I will report this to ${choice.organisationName}:`,
    `${choice.propertyName}${choice.unitName ? `, ${choice.unitName}` : ""}`,
    `${categoryText(classification.category)}: ${classification.title}`,
    `Urgency: ${PRIORITY_TEXT[classification.priority]}`,
    `Photos: ${report.media.length}`,
    classification.safetyHazard ? `\n${SAFETY_ADVICE}` : null,
    "\nReply confirm to send it, edit to describe it again, or cancel.",
  ].filter((line) => line !== null).join("\n");
}

/**
 * One attachment per WhatsApp photo, however many workers handle the confirming message: the
 * database allows one row per (request, source media). A worker that loses the race has its upload
 * rolled back and its stored bytes deleted by the upload pipeline, and counts the winner's copy.
 * A photo that could not be downloaded or stored leaves no row, so a later pass can add it.
 */
export async function attachMedia(userId: string, organisationId: string, requestId: string, media: ReportState["media"]) {
  let saved = 0;
  for (const item of media) {
    const sourceMediaId = `whatsapp:${item.id}`;
    const attached = async () => Boolean(await db.maintenanceAttachment.findUnique({ where: { maintenanceRequestId_sourceMediaId: { maintenanceRequestId: requestId, sourceMediaId } }, select: { id: true } }));
    if (await attached()) { saved += 1; continue; }
    const file = await downloadWhatsAppMedia(item.id).catch(() => null);
    if (!file) continue;
    const fileName = `whatsapp-${item.id}.${(item.mimeType ?? file.contentType).split("/")[1]?.replace("jpeg", "jpg") ?? "jpg"}`;
    try {
      await uploadOrganisationDocument(userId, organisationId, { targetType: "MAINTENANCE_ATTACHMENT", targetId: requestId, fileName, contentType: file.contentType, dataBase64: file.body.toString("base64"), sourceMediaId });
      saved += 1;
    } catch {
      // Lost the race to a concurrent pass (its attachment stands), or the upload failed (retryable).
      if (await attached()) saved += 1;
    }
  }
  return saved;
}

async function submit(userId: string, report: ReportState, messageId: string, state: AssistantState, reset: () => AssistantState): Promise<ReportResult> {
  const choice = report.choices[report.selected ?? 0];
  const classification = report.classification!;
  if (report.duplicate) {
    await addTenantMaintenanceDetails(userId, choice.organisationId, report.duplicate.id, { note: `Tenant reported again on WhatsApp: ${report.description}`, sourceMessageId: messageId });
    const photos = await attachMedia(userId, choice.organisationId, report.duplicate.id, report.media);
    return { state: reset(), reply: `Added to ${report.duplicate.referenceNumber}.${report.media.length ? ` Photos saved: ${photos} of ${report.media.length}.` : ""} Reply status ${report.duplicate.referenceNumber} for updates.` };
  }
  // One ticket per confirming message, enforced by a unique intake reference: a retried or
  // concurrent pass for the same message gets the ticket the first one created.
  const created = await createMaintenanceRequest(userId, choice.organisationId, {
    intakeReference: `whatsapp:${messageId}`,
    propertyId: choice.propertyId, unitId: choice.unitId, tenantOrganisationId: choice.tenantOrganisationId,
    title: classification.title, description: report.description, category: classification.category, priority: classification.priority,
    intakeChannel: "WHATSAPP", originalReport: report.description,
    classification: { ...classification, sourceMessageId: messageId, photos: report.media.length },
  }) as { id: string; referenceNumber: string | null };
  const photos = await attachMedia(userId, choice.organisationId, created.id, report.media);
  return {
    state: reset(),
    reply: [
      `Request ${created.referenceNumber} is logged with ${choice.organisationName}: ${categoryText(classification.category)}, ${classification.title} (${PRIORITY_TEXT[classification.priority]}).`,
      report.media.length ? `Photos saved: ${photos} of ${report.media.length}.` : null,
      "Your landlord's team can see it now. I will message you here when it is updated.",
      classification.safetyHazard ? SAFETY_ADVICE : null,
      `Reply status ${created.referenceNumber} at any time.`,
    ].filter(Boolean).join("\n"),
  };
}

/**
 * Tenant repair reports on the official number. Nothing about a tenancy is shown until the number
 * is linked to an account and that account has a tenancy the landlord connected to it; a phone
 * number on a landlord's tenant record is never treated as proof. Returns null when the message
 * is not for this flow.
 */
export async function advanceReport(input: ReportInput, linked: Linked, state: AssistantState, reset: () => AssistantState): Promise<ReportResult | null> {
  const command = input.body.trim().toLowerCase();
  const inFlow = state.workflow === "report" && state.report;

  // A tenant access code from the landlord connects the account to that tenancy.
  if (!inFlow && input.kind === "text" && ACCESS_CODE.test(input.body.trim())) {
    if (!linked) return { state, reply: "First connect this WhatsApp number to your NesAfric account: reply link. Then send the code again.", redactInbound: true };
    try {
      await redeemTenantAccessCode(linked.user.id, input.body.trim());
    } catch (error) {
      if (error instanceof AppError && error.status < 500) return { state, reply: "That tenant access code is not valid, has expired or was already used. Ask your landlord for a new one.", redactInbound: true };
      throw error;
    }
    const choices = await tenancyChoices(linked.user.id);
    return { state, reply: `Your tenancy is connected${choices.length ? `: ${choices.map(label).join("; ")}` : ""}. Reply report to report a problem.`, redactInbound: true };
  }

  const status = /^(status|my requests|requests|my repairs)(?:\s+(nm-\d{4,}))?$/.exec(command);
  if (!inFlow && status && (status[2] || command !== "status")) {
    if (!linked) return { state, reply: notLinkedReply };
    const choices = await tenancyChoices(linked.user.id);
    if (!choices.length) return { state, reply: noTenancyReply };
    return { state, reply: await requestsReply(linked.user.id, choices, status[2]?.toUpperCase()) };
  }

  if (!inFlow) {
    const starts = (input.kind === "text" && (START.test(command) || (state.workflow === "idle" && looksLikeMaintenance(input.body)))) || (input.kind === "image" && state.workflow === "idle");
    if (!starts) return null;
    if (!linked) return START.test(command) || input.kind === "image" ? { state, reply: notLinkedReply } : null;
    const choices = await tenancyChoices(linked.user.id);
    // Someone without a tenancy talking about leaks is probably searching the marketplace.
    if (!choices.length) return START.test(command) || input.kind === "image" ? { state, reply: noTenancyReply } : null;
    const report: ReportState = { step: "describe", choices, media: input.media ? [input.media] : [], description: START.test(command) ? undefined : input.kind === "text" ? input.body.trim().slice(0, 4000) : undefined };
    const next = { ...reset(), workflow: "report" as const, report };
    if (choices.length > 1) return { state: { ...next, report: { ...report, step: "tenancy" } }, reply: `Which home is this about?\n${choices.map((choice, index) => `${index + 1}. ${label(choice)}`).join("\n")}` };
    report.selected = 0;
    if (report.description) return ask({ ...next, report: { ...report, step: "photos" } }, photosPrompt, SKIP);
    return { state: next, reply: "Please describe the problem: what is wrong, where in the home, and since when." };
  }

  const report = state.report!;
  if (command === "cancel" || command === "menu") return { state: reset(), reply: "Report cancelled. Nothing was sent." };
  if (!linked) return { state: reset(), reply: notLinkedReply };

  switch (report.step) {
    case "tenancy": {
      const index = Number(command) - 1;
      if (!report.choices[index]) return { state, reply: `Reply with the number of the home:\n${report.choices.map((choice, position) => `${position + 1}. ${label(choice)}`).join("\n")}` };
      const next = { ...report, selected: index };
      if (next.description) return ask({ ...state, report: { ...next, step: "photos" } }, photosPrompt, SKIP);
      return { state: { ...state, report: { ...next, step: "describe" } }, reply: "Please describe the problem: what is wrong, where in the home, and since when." };
    }
    case "describe":
      return describeStep(input, report, state);
    case "photos": {
      if (input.kind === "image" && input.media) {
        if (report.media.length >= MAX_PHOTOS) return { state, reply: `I have ${MAX_PHOTOS} photos already. Reply done to continue.` };
        const media = [...report.media, input.media];
        return ask({ ...state, report: { ...report, media } }, `Photo ${media.length} received. Send another, or reply done.`, DONE);
      }
      if (input.kind !== "text") return ask(state, "Please send photos only, or reply done.", DONE);
      if (["skip", "done", "no", "none"].includes(command)) return toConfirm(report, state);
      // More words: add them to the description.
      return describeStep(input, { ...report, step: "describe" }, state).then((result) => ask(result.state, "Added to the description. Send photos, or reply done.", DONE));
    }
    case "duplicate": {
      if (command === "same") return ask({ ...state, report: { ...report, step: "confirm" } }, `Reply confirm to add these details${report.media.length ? ` and ${report.media.length} photo(s)` : ""} to ${report.duplicate!.referenceNumber}, or cancel.`, CONFIRM_OR_CANCEL);
      if (command === "new") return ask({ ...state, report: { ...report, step: "confirm", duplicate: undefined } }, confirmText(report, report.choices[report.selected ?? 0]), CONFIRM);
      return ask(state, "Reply same or new.", SAME_OR_NEW);
    }
    case "confirm": {
      if (command === "edit") return { state: { ...state, report: { ...report, step: "describe", description: undefined, classification: undefined, duplicate: undefined } }, reply: "Please describe the problem again." };
      if (command !== "confirm") return ask(state, "Reply confirm to send it, edit to describe it again, or cancel.", CONFIRM);
      return submit(linked.user.id, report, input.messageId, state, reset);
    }
  }
}
