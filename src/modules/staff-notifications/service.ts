import { db } from "@/platform/database/client";
import { PERMISSIONS } from "@/platform/authorization/permissions";
import { membershipHasPermission } from "@/platform/authorization/policy";
import { queueOfficialText } from "@/modules/whatsapp-assistant/outbound";

const DEFAULTS = { digestEnabled: true, digestHour: 18, noActivitySummary: false, attentionInDigest: false, immediateReasons: [] as string[] };
const OPEN = ["REPORTED", "TRIAGED", "AWAITING_APPROVAL", "APPROVED", "ASSIGNED", "IN_PROGRESS"] as const;
const money = (minor: number, currency: string) => `${currency} ${(minor / 100).toFixed(2)}`;
const day = (date: Date) => date.toISOString().slice(0, 10);

type Recipient = { memberId: string; userId: string; displayName: string; phone: string | null; preference: typeof DEFAULTS; canSeeCosts: boolean };

/**
 * Who hears about an organisation's maintenance: the named member, or everyone who can approve
 * maintenance (owners, administrators, property managers). Only a verified, not opted-out
 * WhatsApp link counts as a way to reach them.
 */
export async function recipientsFor(organisationId: string, memberId?: string | null): Promise<Recipient[]> {
  const members = await db.organisationMember.findMany({
    where: { organisationId, status: "ACTIVE", archivedAt: null, ...(memberId ? { id: memberId } : {}) },
    include: { user: { select: { id: true, displayName: true, channelIdentities: { where: { channel: "WHATSAPP", verifiedAt: { not: null }, optedOutAt: null }, select: { address: true }, take: 1 } } }, notificationPreference: true, roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
  });
  return members
    .filter((member) => memberId || membershipHasPermission(member.roles, PERMISSIONS.maintenanceApprove))
    .map((member) => ({
      memberId: member.id, userId: member.userId, displayName: member.user.displayName, phone: member.user.channelIdentities[0]?.address ?? null,
      preference: member.notificationPreference ?? DEFAULTS,
      canSeeCosts: membershipHasPermission(member.roles, PERMISSIONS.paymentRead) || membershipHasPermission(member.roles, "maintenance.cost"),
    }));
}

async function record(input: { organisationId: string; memberId: string; kind: string; level?: string; escalationId?: string; digestDate?: string; dedupeKey: string; status: string; messageId?: string | null; detail?: string }) {
  return db.staffNotification.upsert({ where: { dedupeKey: input.dedupeKey }, update: {}, create: input });
}

/**
 * Background job for every escalation. CRITICAL is sent at once to every recipient, whatever their
 * settings. ATTENTION is sent at once unless the member chose to receive it in the digest.
 * Nothing is suppressed silently: every recipient gets a StaffNotification row saying what
 * happened, and an undeliverable CRITICAL alert is logged for monitoring.
 */
export async function deliverEscalation(escalationId: string) {
  const escalation = await db.maintenanceEscalation.findUnique({ where: { id: escalationId }, include: { maintenanceRequest: { select: { referenceNumber: true } } } });
  if (!escalation || escalation.resolvedAt) return;
  const recipients = await recipientsFor(escalation.organisationId, escalation.recipientMemberId);
  let queued = 0;
  for (const recipient of recipients) {
    const dedupeKey = `alert:${escalation.id}:${recipient.memberId}`;
    if (await db.staffNotification.findUnique({ where: { dedupeKey } })) { queued += 1; continue; }
    const immediate = escalation.level === "CRITICAL" || !recipient.preference.attentionInDigest || recipient.preference.immediateReasons.includes(escalation.reason);
    if (!immediate) { await record({ organisationId: escalation.organisationId, memberId: recipient.memberId, kind: "ALERT", level: escalation.level, escalationId: escalation.id, dedupeKey, status: "SKIPPED", detail: "In the daily digest, as the member chose." }); continue; }
    if (!recipient.phone) { await record({ organisationId: escalation.organisationId, memberId: recipient.memberId, kind: "ALERT", level: escalation.level, escalationId: escalation.id, dedupeKey, status: "FAILED", detail: "No verified WhatsApp number is linked to this member." }); continue; }
    const text = `${escalation.level === "CRITICAL" ? "URGENT: " : ""}${escalation.detail}\nReply show ticket ${escalation.maintenanceRequest.referenceNumber} for details.`;
    const result = await db.$transaction((tx) => queueOfficialText(tx, { phoneE164: recipient.phone!, displayName: recipient.displayName, text, externalMessageId: dedupeKey, metadata: { escalationId: escalation.id } }));
    await record({ organisationId: escalation.organisationId, memberId: recipient.memberId, kind: "ALERT", level: escalation.level, escalationId: escalation.id, dedupeKey, status: "reason" in result ? "FAILED" : "QUEUED", messageId: result.messageId, detail: "reason" in result ? result.reason : undefined });
    if (!("reason" in result)) queued += 1;
  }
  if (queued) await db.maintenanceEscalation.update({ where: { id: escalation.id }, data: { notifiedAt: escalation.notifiedAt ?? new Date() } });
  else if (escalation.level === "CRITICAL") console.warn(JSON.stringify({ event: "maintenance.critical_alert_undelivered", organisationId: escalation.organisationId, escalationId: escalation.id }));
}

/**
 * The daily summary, built only from records: tickets, dispatches, acceptances, completions,
 * costs (only for members allowed to see them), approvals, provider failures, open alerts and
 * upcoming lease expiries.
 */
export async function buildDigest(organisationId: string, from: Date, to: Date, options: { canSeeCosts: boolean }) {
  const organisation = await db.organisation.findUniqueOrThrow({ where: { id: organisationId }, select: { name: true, defaultCurrencyCode: true } });
  const [created, dispatched, accepted, completed, inProgress, overdue, failures, alerts, approvals, approvedQuotes, leases] = await Promise.all([
    db.maintenanceRequest.findMany({ where: { organisationId, createdAt: { gte: from, lt: to } }, select: { referenceNumber: true, title: true, priority: true }, orderBy: { createdAt: "asc" }, take: 20 }),
    db.maintenanceRoutingDecision.count({ where: { organisationId, outcome: "DISPATCHED", createdAt: { gte: from, lt: to } } }),
    db.providerAssignment.count({ where: { landlordOrganisationId: organisationId, acceptedAt: { gte: from, lt: to } } }),
    db.workOrder.findMany({ where: { organisationId, completedAt: { gte: from, lt: to } }, select: { title: true, actualCostAmountMinor: true } }),
    db.maintenanceRequest.count({ where: { organisationId, status: "IN_PROGRESS" } }),
    db.maintenanceRequest.count({ where: { organisationId, status: { in: [...OPEN] }, createdAt: { lt: new Date(to.getTime() - 7 * 86_400_000) } } }),
    db.maintenanceDispatchAttempt.count({ where: { organisationId, status: { in: ["DECLINED", "NO_RESPONSE", "CONTACT_FAILED"] }, updatedAt: { gte: from, lt: to } } }),
    db.maintenanceEscalation.findMany({ where: { organisationId, resolvedAt: null }, select: { level: true, detail: true }, orderBy: { createdAt: "desc" }, take: 5 }),
    db.maintenanceApproval.count({ where: { organisationId, status: "PENDING" } }),
    db.maintenanceApproval.findMany({ where: { organisationId, status: "APPROVED", decidedAt: { gte: from, lt: to } }, select: { approvedAmountMinor: true } }),
    db.lease.findMany({ where: { organisationId, status: { in: ["ACTIVE", "EXPIRING"] }, endDate: { gte: to, lt: new Date(to.getTime() + 30 * 86_400_000) } }, select: { referenceNumber: true, endDate: true, property: { select: { name: true } }, unit: { select: { name: true } } }, orderBy: { endDate: "asc" }, take: 5 }),
  ]);
  const unresolved = await db.maintenanceEscalation.count({ where: { organisationId, resolvedAt: null } });
  const empty = !created.length && !dispatched && !accepted && !completed.length && !failures && !unresolved && !approvals && !leases.length;
  const currency = organisation.defaultCurrencyCode;
  const cost = completed.reduce((sum, workOrder) => sum + Number(workOrder.actualCostAmountMinor ?? 0), 0);
  const approvedTotal = approvedQuotes.reduce((sum, approval) => sum + Number(approval.approvedAmountMinor ?? 0), 0);
  const lines = [
    `${organisation.name}: maintenance for ${day(from)}`,
    `New requests: ${created.length}${created.length ? ` (${created.slice(0, 5).map((request) => `${request.referenceNumber}${request.priority === "EMERGENCY" ? " EMERGENCY" : ""}`).join(", ")}${created.length > 5 ? ", …" : ""})` : ""}`,
    `Sent to providers automatically: ${dispatched}. Accepted: ${accepted}.`,
    `In progress: ${inProgress}. Completed: ${completed.length}${options.canSeeCosts && completed.length ? `, costing ${money(cost, currency)}` : ""}.`,
    options.canSeeCosts && approvedQuotes.length ? `Quotes approved: ${approvedQuotes.length} (${money(approvedTotal, currency)}).` : null,
    `Open for more than 7 days: ${overdue}. Provider declines or no answers: ${failures}.`,
    approvals ? `Waiting for your approval: ${approvals}. Reply which repairs need my approval.` : null,
    unresolved ? `Needs your attention (${unresolved}):\n${alerts.map((alert) => `• ${alert.level === "CRITICAL" ? "URGENT " : ""}${alert.detail}`).join("\n")}` : null,
    leases.length ? `Leases ending in the next 30 days:\n${leases.map((lease) => `• ${lease.property.name}${lease.unit ? `, ${lease.unit.name}` : ""} on ${lease.endDate ? day(lease.endDate) : "—"}`).join("\n")}` : null,
    "Reply show ticket NM-1001 for any ticket.",
  ].filter(Boolean);
  return { empty, text: empty ? `${organisation.name}: no maintenance activity on ${day(from)}.` : lines.join("\n") };
}

/** One digest per member per day: the dedupe key makes repeated scheduling and retries harmless. */
export async function deliverDigest(organisationId: string, memberId: string, date: string) {
  const dedupeKey = `digest:${memberId}:${date}`;
  if (await db.staffNotification.findUnique({ where: { dedupeKey } })) return;
  const [recipient] = await recipientsFor(organisationId, memberId);
  if (!recipient || !recipient.preference.digestEnabled) return record({ organisationId, memberId, kind: "DIGEST", digestDate: date, dedupeKey, status: "SKIPPED", detail: "Digest turned off." });
  const from = new Date(`${date}T00:00:00.000Z`);
  const digest = await buildDigest(organisationId, from, new Date(from.getTime() + 86_400_000), { canSeeCosts: recipient.canSeeCosts });
  if (digest.empty && !recipient.preference.noActivitySummary) return record({ organisationId, memberId, kind: "DIGEST", digestDate: date, dedupeKey, status: "SKIPPED", detail: "No activity." });
  if (!recipient.phone) return record({ organisationId, memberId, kind: "DIGEST", digestDate: date, dedupeKey, status: "FAILED", detail: "No verified WhatsApp number is linked to this member." });
  const result = await db.$transaction((tx) => queueOfficialText(tx, { phoneE164: recipient.phone!, displayName: recipient.displayName, text: digest.text, externalMessageId: dedupeKey, metadata: { digestDate: date } }));
  return record({ organisationId, memberId, kind: "DIGEST", digestDate: date, dedupeKey, status: "reason" in result ? "FAILED" : "QUEUED", messageId: result.messageId, detail: "reason" in result ? result.reason : undefined });
}

/**
 * Called on every worker poll and scheduled run: queues today's digest job for each member who
 * can be reached on WhatsApp, manages properties, and whose digest hour has passed. Idempotent.
 */
export async function scheduleDueDigests(now = new Date()) {
  const date = day(now);
  const hour = now.getUTCHours();
  const members = await db.organisationMember.findMany({
    where: { status: "ACTIVE", archivedAt: null, organisation: { archivedAt: null, properties: { some: { archivedAt: null } } }, user: { channelIdentities: { some: { channel: "WHATSAPP", verifiedAt: { not: null }, optedOutAt: null } } } },
    include: { notificationPreference: true, roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
    take: 1000,
  });
  let queued = 0;
  for (const member of members) {
    const preference = member.notificationPreference ?? DEFAULTS;
    if (!preference.digestEnabled || hour < preference.digestHour || !membershipHasPermission(member.roles, PERMISSIONS.maintenanceApprove)) continue;
    const key = `daily-digest:${member.id}:${date}`;
    const created = await db.backgroundJob.upsert({ where: { idempotencyKey: key }, update: {}, create: { organisationId: member.organisationId, type: "daily-digest", idempotencyKey: key, payload: { organisationId: member.organisationId, memberId: member.id, date }, maxAttempts: 5 } });
    if (created.createdAt.getTime() >= now.getTime() - 1000) queued += 1;
  }
  return { queued };
}

export async function getNotificationPreference(memberId: string) {
  return (await db.notificationPreference.findUnique({ where: { memberId } })) ?? { memberId, ...DEFAULTS };
}

export async function updateNotificationPreference(memberId: string, organisationId: string, input: Partial<typeof DEFAULTS>) {
  if (input.digestHour !== undefined && !(Number.isInteger(input.digestHour) && input.digestHour >= 0 && input.digestHour <= 23)) throw new Error("Digest hour must be 0 to 23.");
  return db.notificationPreference.upsert({ where: { memberId }, update: input, create: { memberId, organisationId, ...DEFAULTS, ...input } });
}
