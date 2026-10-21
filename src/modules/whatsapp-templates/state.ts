import { db } from "@/platform/database/client";
import type { Prisma } from "@/platform/database/generated/client";
import { activeWhatsAppAssignment } from "@/modules/conversations/channels/whatsapp-numbers";
import type { WhatsAppTemplateEvent } from "@/modules/conversations/channels/whatsapp-payload";
import { officialWhatsAppOrganisationId } from "@/modules/whatsapp-assistant/identity";
import { metaContentHash, templateContentHash, templateCreationPayload, validateUtilityTemplate } from "./format";
import { metaTemplateClient, MetaTemplateApiError, type MetaTemplate, type MetaTemplateClient } from "./meta-client";
import { metaTemplateName, UTILITY_TEMPLATES, utilityTemplate, type UtilityTemplate } from "./registry";

type Client = Prisma.TransactionClient | typeof db;
type Env = Record<string, string | undefined>;

/** Statuses after which a template is on Meta and must never be created again under that name. */
const ON_META = new Set(["APPROVED", "PENDING", "IN_APPEAL", "PAUSED", "DISABLED", "FLAGGED", "LIMIT_EXCEEDED", "REINSTATED", "PENDING_DELETION", "ARCHIVED"]);

function log(event: string, detail: Record<string, unknown>) {
  console.info(JSON.stringify({ event, ...detail }));
}

/**
 * The WABA of the official NesAfric number, as the platform assignment records it. Only the
 * official number's WABA is ever used: another organisation's (or another product's, such as
 * Tap & Order's) WABA reachable with the same token is never read or written.
 */
export async function officialWaba(client: Client = db, env: Env = process.env) {
  const officialId = officialWhatsAppOrganisationId(env);
  if (!officialId) return null;
  const assignment = await activeWhatsAppAssignment(client, officialId);
  if (!assignment?.official || !assignment.businessAccountId) return null;
  return { officialId, wabaId: assignment.businessAccountId };
}

/**
 * Template management also needs `WHATSAPP_TEMPLATE_WABA_ID` set to the same WABA: two
 * independent records must agree before anything is read from or written to Meta.
 */
export async function managedWaba(env: Env = process.env) {
  const waba = await officialWaba(db, env);
  if (!waba) throw new Error("The official NesAfric WhatsApp number has no WhatsApp Business Account ID on its platform assignment.");
  const configured = env.WHATSAPP_TEMPLATE_WABA_ID?.trim();
  if (!configured) throw new Error("WHATSAPP_TEMPLATE_WABA_ID is not set.");
  if (configured !== waba.wabaId) throw new Error("WHATSAPP_TEMPLATE_WABA_ID does not match the official number's WhatsApp Business Account; nothing was changed.");
  return waba;
}

async function audit(organisationId: string, action: string, template: UtilityTemplate | null, metadata: Record<string, unknown>) {
  await db.auditEvent.create({ data: { organisationId, action, entityType: "whatsapp_template", entityId: template?.key ?? String(metadata.metaName ?? "unknown"), metadata: JSON.parse(JSON.stringify(metadata)) } });
  log(action, { templateKey: template?.key, ...metadata });
}

async function saveRemote(officialId: string, wabaId: string, template: UtilityTemplate, remote: MetaTemplate | undefined, now: Date) {
  const where = { wabaId_metaName_language: { wabaId, metaName: metaTemplateName(template), language: template.language } };
  const before = await db.whatsAppTemplateState.findUnique({ where });
  const status = remote?.status ?? (before?.metaTemplateId ? "DELETED" : "NOT_SUBMITTED");
  const data = {
    status, version: template.version, lastSyncedAt: now,
    contentHash: remote ? metaContentHash(remote) : before?.contentHash ?? templateContentHash(template),
    ...(remote ? { metaTemplateId: remote.id, metaCategory: remote.category, rejectedReason: remote.rejected_reason && remote.rejected_reason !== "NONE" ? remote.rejected_reason : null, qualityScore: remote.quality_score?.score ?? null } : {}),
    ...(before?.status !== status ? { lastStatusAt: now } : {}),
  };
  const saved = await db.whatsAppTemplateState.upsert({ where, update: data, create: { templateKey: template.key, wabaId, metaName: metaTemplateName(template), language: template.language, ...data } });
  if (before?.status !== status || before?.metaCategory !== saved.metaCategory) {
    await audit(officialId, "whatsapp_template.status_synced", template, { metaName: saved.metaName, fromStatus: before?.status ?? null, toStatus: status, metaCategory: saved.metaCategory });
  }
  return saved;
}

/** Reads every template on the WABA and records Meta's status for the registry's. Read-only on Meta. */
export async function syncTemplateStatuses(options: { client?: MetaTemplateClient; env?: Env; now?: Date } = {}) {
  const env = options.env ?? process.env;
  const { officialId, wabaId } = await managedWaba(env);
  const remote = await (options.client ?? metaTemplateClient(env)).list(wabaId);
  const now = options.now ?? new Date();
  const find = (template: UtilityTemplate) => remote.find((item) => item.name === metaTemplateName(template) && item.language === template.language);
  const states = [];
  for (const template of UTILITY_TEMPLATES) states.push(await saveRemote(officialId, wabaId, template, find(template), now));
  const managed = new Set(UTILITY_TEMPLATES.map(metaTemplateName));
  // Templates outside the registry (for example the existing NOTIFICATION, PROVIDER_INVITE and
  // WORK_ORDER templates) are reported, never changed.
  const unmanaged = remote.filter(({ name }) => !managed.has(name)).map(({ name, language, status, category }) => ({ name, language, status, category }));
  return { wabaId, states, unmanaged };
}

export type SubmissionOutcome = { key: string; metaName: string; result: "SUBMITTED" | "SKIPPED" | "ERROR"; status?: string; category?: string; reason?: string };

/**
 * Submits registry templates for Meta's review. Refuses unless submission is switched on
 * (`WHATSAPP_TEMPLATE_SUBMISSION_ENABLED=true`) and the caller names the WABA it expects. A
 * template that is already on Meta, or was rejected, is never created again: a rejected template
 * needs its text fixed and its version bumped, which gives it a new name.
 */
export async function submitTemplates(input: { keys: string[]; confirmWabaId: string; acknowledgeFlags?: string[]; client?: MetaTemplateClient; env?: Env; now?: Date }) {
  const env = input.env ?? process.env;
  if (env.WHATSAPP_TEMPLATE_SUBMISSION_ENABLED !== "true") throw new Error("Template submission is switched off (WHATSAPP_TEMPLATE_SUBMISSION_ENABLED).");
  const client = input.client ?? metaTemplateClient(env);
  const { officialId, wabaId } = await managedWaba(env);
  if (input.confirmWabaId !== wabaId) throw new Error("The confirmed WhatsApp Business Account is not the official one; nothing was submitted.");
  const synced = await syncTemplateStatuses({ client, env, now: input.now });
  const outcomes: SubmissionOutcome[] = [];
  for (const key of input.keys) {
    const template = utilityTemplate(key);
    const metaName = metaTemplateName(template);
    const state = synced.states.find((item) => item.templateKey === key);
    const skip = (reason: string) => outcomes.push({ key, metaName, result: "SKIPPED", status: state?.status, reason });
    const { errors, flags } = validateUtilityTemplate(template);
    if (errors.length) { skip(`Invalid: ${errors.join(" ")}`); continue; }
    if (template.content !== "FINAL") { skip(template.content === "NEEDS_REVIEW" ? "The catalogue text failed a check and needs an approved catalogue change first." : "The body is a draft; replace it with the catalogue text and mark it FINAL."); continue; }
    if (flags.length && !input.acknowledgeFlags?.includes(key)) { skip(`Needs review: ${flags.join(" ")}`); continue; }
    if (state?.status === "REJECTED") { skip(`Rejected by Meta (${state.rejectedReason ?? "no reason given"}). Fix the text and bump the version; it is not resubmitted automatically.`); continue; }
    if (state && ON_META.has(state.status)) { skip(`Already on Meta as ${state.status}; not overwritten.`); continue; }
    try {
      const created = await client.create(wabaId, templateCreationPayload(template));
      const now = input.now ?? new Date();
      await db.whatsAppTemplateState.update({
        where: { wabaId_metaName_language: { wabaId, metaName, language: template.language } },
        data: { status: created.status, metaTemplateId: created.id, metaCategory: created.category, contentHash: templateContentHash(template), submittedAt: now, lastStatusAt: now, rejectedReason: null },
      });
      await audit(officialId, "whatsapp_template.submitted", template, { metaName, metaTemplateId: created.id, status: created.status, metaCategory: created.category });
      outcomes.push({ key, metaName, result: "SUBMITTED", status: created.status, category: created.category, ...(created.category !== "UTILITY" ? { reason: `Meta assigned category ${created.category}; it will not be sent as Utility.` } : {}) });
    } catch (error) {
      const reason = error instanceof MetaTemplateApiError ? error.message : "The request to Meta failed.";
      await audit(officialId, "whatsapp_template.submission_failed", template, { metaName, reason });
      outcomes.push({ key, metaName, result: "ERROR", reason });
    }
  }
  return { wabaId, outcomes };
}

/** Meta's `message_template_status_update`, `template_category_update` and quality webhooks. */
export async function recordTemplateWebhookEvent(event: WhatsAppTemplateEvent, now = new Date()) {
  const waba = await officialWaba();
  if (!waba || waba.wabaId !== event.wabaId) return log("whatsapp_template.webhook_ignored", { reason: "not the official WABA", name: event.name });
  const state = await db.whatsAppTemplateState.findUnique({ where: { wabaId_metaName_language: { wabaId: event.wabaId, metaName: event.name, language: event.language } } });
  const template = state ? utilityTemplate(state.templateKey) : null;
  if (!state) return log("whatsapp_template.webhook_unmanaged", { name: event.name, language: event.language, kind: event.kind });
  const data = event.kind === "status"
    ? { status: event.event, lastStatusAt: now, metaTemplateId: event.metaTemplateId, rejectedReason: event.event === "REJECTED" ? (event.reason && event.reason !== "NONE" ? event.reason : "not given") : state.rejectedReason }
    : event.kind === "category" ? { metaCategory: event.newCategory } : { qualityScore: event.newScore };
  await db.whatsAppTemplateState.update({ where: { id: state.id }, data });
  await audit(waba.officialId, `whatsapp_template.${event.kind}_changed`, template, { metaName: event.name, ...(event.kind === "status" ? { fromStatus: state.status, toStatus: event.event, reason: event.reason ?? null } : event.kind === "category" ? { fromCategory: state.metaCategory, toCategory: event.newCategory } : { qualityScore: event.newScore }) });
}

/**
 * Whether this template may be sent now: approved by Meta, still Utility, with exactly the text
 * the registry would render. Anything else is a reason not to send.
 */
export async function approvedTemplate(client: Client, template: UtilityTemplate) {
  const waba = await officialWaba(client);
  if (!waba) return { approved: false as const, reason: "The official NesAfric WhatsApp number has no WhatsApp Business Account on its assignment." };
  const state = await client.whatsAppTemplateState.findUnique({ where: { wabaId_metaName_language: { wabaId: waba.wabaId, metaName: metaTemplateName(template), language: template.language } } });
  if (!state || state.status !== "APPROVED") return { approved: false as const, reason: `Template ${template.key} is ${state?.status ?? "NOT_SUBMITTED"}, not APPROVED.` };
  if (state.metaCategory !== "UTILITY") return { approved: false as const, reason: `Meta categorised template ${template.key} as ${state.metaCategory ?? "unknown"}, not UTILITY.` };
  if (state.contentHash !== templateContentHash(template)) return { approved: false as const, reason: `Template ${template.key} in the registry differs from the approved text; bump its version and submit it.` };
  return { approved: true as const, name: state.metaName, language: state.language };
}

/** Every registry template with its validation result and Meta's status, for the status report. */
export async function templateStatusReport(client: Client = db) {
  const waba = await officialWaba(client);
  const states = waba ? await client.whatsAppTemplateState.findMany({ where: { wabaId: waba.wabaId } }) : [];
  return UTILITY_TEMPLATES.map((template) => {
    const state = states.find((item) => item.metaName === metaTemplateName(template) && item.language === template.language);
    const { errors, flags } = validateUtilityTemplate(template);
    return {
      key: template.key, metaName: metaTemplateName(template), version: template.version, group: template.group, recipient: template.recipient,
      event: template.trigger.event, wiring: template.wiring.status, content: template.content,
      status: state?.status ?? "NOT_SUBMITTED", metaCategory: state?.metaCategory ?? null, rejectedReason: state?.rejectedReason ?? null,
      contentMatchesApproved: state ? state.contentHash === templateContentHash(template) : null,
      lastSyncedAt: state?.lastSyncedAt ?? null, errors, flags,
    };
  });
}
