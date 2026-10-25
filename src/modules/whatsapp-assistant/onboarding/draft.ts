import { z } from "zod";
import { db } from "@/platform/database/client";
import type { Prisma } from "@/platform/database/generated/client";

const unit = z.object({ name: z.string().min(1).max(80), unitType: z.string().max(80).optional(), bedrooms: z.number().int().min(0).max(99).optional() });
const building = z.object({ name: z.string().max(120).nullable(), units: z.array(unit).max(500).default([]) });
const property = z.object({
  name: z.string().min(2).max(200),
  city: z.string().max(100).optional(),
  addressLine1: z.string().max(250).optional(),
  buildings: z.array(building).max(20).default([]),
});
const tenant = z.object({
  propertyIndex: z.number().int().min(0),
  unitName: z.string().max(80),
  legalName: z.string().min(2).max(200),
  phone: z.string().max(20).optional(),
  rentAmountMinor: z.string().regex(/^\d+$/),
  rentFrequency: z.enum(["MONTHLY", "QUARTERLY", "ANNUAL"]),
  startDate: z.string(),
  endDate: z.string().optional(),
});
const provider = z.object({ name: z.string().max(160), phone: z.string().max(20), category: z.string().max(60) });

export const onboardingDataSchema = z.object({
  role: z.enum(["LANDLORD", "MANAGER"]).optional(),
  displayName: z.string().min(2).max(100).optional(),
  /** OTP challenge for creating or confirming the account; the code itself is never stored. */
  challengeId: z.string().uuid().optional(),
  codeFailures: z.number().int().min(0).default(0),
  /** Existing organisations offered at the organisation step, in the order shown. */
  organisationChoices: z.array(z.object({ id: z.string().uuid(), name: z.string() })).max(9).default([]),
  existingOrganisationId: z.string().uuid().optional(),
  organisationName: z.string().min(2).max(160).optional(),
  countryCode: z.string().length(2).default("GH"),
  currencyCode: z.string().length(3).default("GHS"),
  properties: z.array(property).max(20).default([]),
  /** Cursor for the building currently being described. */
  cursor: z.object({ property: z.number().int().min(0), building: z.number().int().min(0) }).default({ property: 0, building: 0 }),
  tenants: z.array(tenant).max(500).default([]),
  /** The landlord confirmed these tenants live in the units now and agreed to WhatsApp messages:
   * tenancies that have started are saved active, and each tenant with a phone is invited. */
  inviteTenants: z.boolean().optional(),
  leaseExpiryReminders: z.boolean().optional(),
  providers: z.array(provider).max(50).default([]),
  /** Spending that may proceed without the landlord, in minor units. "0" = always ask. */
  approvalLimitMinor: z.string().regex(/^\d+$/).optional(),
  /** Who gets urgent maintenance alerts: the landlord, or another E.164 number. */
  emergencyContact: z.string().max(20).optional(),
  committed: z.object({
    organisationId: z.string().uuid().optional(),
    properties: z.record(z.string(), z.string().uuid()).default({}),
    buildings: z.record(z.string(), z.string().uuid()).default({}),
    tenants: z.record(z.string(), z.object({ tenantOrganisationId: z.string().uuid(), leaseId: z.string().uuid().optional() })).default({}),
    reminders: z.boolean().default(false),
    verifications: z.boolean().default(false),
    providersInvited: z.boolean().default(false),
    tenantsInvited: z.boolean().default(false),
  }).default({ properties: {}, buildings: {}, tenants: {}, reminders: false, verifications: false, providersInvited: false, tenantsInvited: false }),
}).strict();
export type OnboardingData = z.infer<typeof onboardingDataSchema>;

export const STEPS = [
  "role", "name", "account_code", "organisation", "property_name", "property_city", "property_address",
  "buildings", "units", "unit_type", "more_properties", "tenants_offer", "tenants", "tenant_invites", "reminders",
  "providers_offer", "providers", "approval_limit", "emergency_contact", "review",
] as const;
export type Step = (typeof STEPS)[number];

export type Draft = { id: string; address: string; userId: string | null; status: "IN_PROGRESS" | "COMMITTING" | "COMMITTED" | "ABANDONED"; step: Step; data: OnboardingData; lastMessageId: string | null };

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));

function toDraft(row: { id: string; address: string; userId: string | null; status: Draft["status"]; step: string; data: unknown; lastMessageId: string | null }): Draft {
  return { ...row, step: (STEPS as readonly string[]).includes(row.step) ? row.step as Step : "review", data: onboardingDataSchema.parse(row.data) };
}

/** The unfinished draft for this number, if any. */
export async function findOpenDraft(address: string) {
  const row = await db.onboardingDraft.findFirst({ where: { channel: "WHATSAPP", address, status: { in: ["IN_PROGRESS", "COMMITTING"] } }, orderBy: { createdAt: "desc" } });
  return row ? toDraft(row) : null;
}

export async function startDraft(address: string, userId: string | null, defaults: { countryCode: string; currencyCode: string }) {
  const existing = await findOpenDraft(address);
  if (existing) return existing;
  const data = onboardingDataSchema.parse({ countryCode: defaults.countryCode, currencyCode: defaults.currencyCode });
  return toDraft(await db.onboardingDraft.create({ data: { channel: "WHATSAPP", address, userId, step: "role", data: json(data) } }));
}

export async function saveDraft(draft: Draft, messageId: string | null) {
  return toDraft(await db.onboardingDraft.update({ where: { id: draft.id }, data: { step: draft.step, data: json(onboardingDataSchema.parse(draft.data)), userId: draft.userId, status: draft.status, lastMessageId: messageId } }));
}

export async function abandonDraft(id: string) {
  await db.onboardingDraft.updateMany({ where: { id, status: "IN_PROGRESS" }, data: { status: "ABANDONED" } });
}

export async function loadDraft(id: string) {
  const row = await db.onboardingDraft.findUnique({ where: { id } });
  return row ? toDraft(row) : null;
}
