import { createMarketplaceProfessional, listUserMarketplaceProfessionals, submitMarketplaceVerificationInTransaction } from "@/modules/marketplace-professionals/service";
import type { Prisma } from "@/platform/database/generated/client";
import { db } from "@/platform/database/client";
import { formatPhoneForDisplay, normalizePhone } from "@/platform/identity/phone";
import { runOnce } from "../actions";
import type { Ctx, StartSeed, Workflow } from "../context";
import { askField, askNextField, beginEdit, editOptions, handleFieldAnswer, SKIP_HINT, summaryLines, type FieldSpec, type FormData } from "../form";
import { ensureUserForContact, linkedUser } from "../identity";
import { normalize, parseEmail, parseList, parseYesNo } from "../nlu";
import { referenceFor } from "../references";
import { deliverWhatsAppNotificationNow, enqueueWhatsAppNotificationInTx, type WhatsAppNotificationJob } from "../notification-outbox";
import { recordEventInTx } from "../store";
import { createSupportRequest } from "./status";

/**
 * Real-estate business onboarding through WhatsApp. Every kind becomes a `MarketplaceProfessional`
 * created by the existing service (the same record the website creates) and is immediately put
 * into NesAfric's verification queue (`PENDING`). Nothing here verifies anyone: only a platform
 * reviewer can, from the existing admin queue.
 */
export const BUSINESS_KINDS = {
  AGENCY: { title: "Agency / brokerage", type: "BROKERAGE", company: true, specialityLabel: "real estate services" },
  MARKETING: { title: "Marketing company", type: "PROPERTY_MARKETING_COMPANY", company: true, specialityLabel: "property marketing services" },
  DEVELOPER: { title: "Property developer", type: "DEVELOPER", company: true, specialityLabel: "developments" },
  PROPERTY_MANAGER: { title: "Property management", type: "REAL_ESTATE_COMPANY", company: true, specialityLabel: "property management services" },
  AGENT: { title: "Independent agent", type: "INDIVIDUAL_AGENT", company: false, specialityLabel: "property types" },
  LANDLORD: { title: "Landlord / owner", type: "OTHER", company: false, specialityLabel: "properties" },
} as const;

export type BusinessKind = keyof typeof BUSINESS_KINDS;

type Data = FormData & {
  kind?: BusinessKind;
  legalName?: string;
  brandName?: string;
  registrationNumber?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  phoneConfirmed?: boolean;
  areas?: string[];
  specialities?: string[];
  description?: string;
  website?: string;
  affiliation?: string;
  affiliationProfessionalId?: string;
};

const isCompany = (data: Data) => Boolean(data.kind && BUSINESS_KINDS[data.kind].company);

const text = (key: keyof Data, min: number, max: number, error: string) => (ctx: Ctx, data: Data) => {
  const value = ctx.text.replace(/\s+/g, " ").trim();
  if (value.length < min || value.length > max) return { ok: false as const, error };
  (data as Record<string, unknown>)[key] = value;
  return { ok: true as const };
};

const FIELDS: FieldSpec<Data>[] = [
  {
    key: "legalName",
    label: "Name",
    ask: (ctx, data) => ctx.prompt(isCompany(data) ? "What is the business's *official registered name*?" : "What is your *full name*?"),
    parse: (ctx, data) => text("legalName", 2, 200, "Please send the name (2–200 characters).")(ctx, data),
    summary: (data) => `${isCompany(data) ? "Registered name" : "Name"}: ${data.legalName}`,
  },
  {
    key: "brandName",
    label: "Brand name",
    optional: true,
    applies: isCompany,
    ask: (ctx) => ctx.prompt(`Does the business trade under a different *public brand name*? Send it, or reply *skip* if it's the same.`),
    parse: (ctx, data) => text("brandName", 2, 200, "Please send the brand name, or *skip*.")(ctx, data),
    summary: (data) => (data.brandName ? `Brand name: ${data.brandName}` : null),
  },
  {
    key: "registrationNumber",
    label: "Registration no.",
    optional: true,
    applies: isCompany,
    ask: (ctx) => ctx.prompt(`What is the business *registration number* (Office of the Registrar of Companies)? ${SKIP_HINT}`),
    parse: (ctx, data) => {
      const value = ctx.text.trim();
      if (!/^[A-Za-z0-9][A-Za-z0-9 /.-]{2,49}$/.test(value)) return { ok: false, error: "That doesn't look like a registration number. Please check it, or reply *skip*." };
      data.registrationNumber = value.toUpperCase();
      return { ok: true };
    },
    summary: (data) => (data.registrationNumber ? `Registration no.: ${data.registrationNumber}` : null),
  },
  {
    key: "contactName",
    label: "Contact person",
    applies: isCompany,
    ask: (ctx) => ctx.prompt("Who is the *main contact person*? (full name)"),
    parse: (ctx, data) => text("contactName", 2, 160, "Please send the contact person's full name.")(ctx, data),
    summary: (data) => (data.contactName ? `Contact: ${data.contactName}` : null),
  },
  {
    key: "phone",
    label: "Phone",
    ask: (ctx, data) => {
      if (data.phoneConfirmed === false) return ctx.prompt("Please type the phone number to use, e.g. *024 123 4567*.");
      ctx.ask(`Is *${formatPhoneForDisplay(ctx.contact.phoneE164 ?? `+${ctx.contact.waId}`)}* (this WhatsApp number) the best number for ${isCompany(data) ? "the business" : "you"}?`, [
        { id: "br:phone:yes", title: "Yes, use this" },
        { id: "br:phone:other", title: "Use another" },
      ]);
    },
    parse: (ctx, data) => {
      if (ctx.choice === "br:phone:yes" || (data.phoneConfirmed !== false && parseYesNo(ctx.text) === true)) {
        data.phone = ctx.contact.phoneE164 ?? `+${ctx.contact.waId}`;
        delete data.phoneConfirmed;
        return { ok: true };
      }
      if (ctx.choice === "br:phone:other" || (data.phoneConfirmed !== false && parseYesNo(ctx.text) === false)) {
        data.phoneConfirmed = false;
        return { ok: false, error: "No problem." };
      }
      const phone = normalizePhone(ctx.text);
      if (!phone) return { ok: false, error: "That doesn't look like a valid mobile number." };
      data.phone = phone;
      delete data.phoneConfirmed;
      return { ok: true };
    },
    summary: (data) => (data.phone ? `Phone: ${formatPhoneForDisplay(data.phone)}` : null),
  },
  {
    key: "email",
    label: "Email",
    optional: true,
    ask: (ctx, data) => ctx.prompt(`What ${isCompany(data) ? "business " : ""}email address should we use? ${SKIP_HINT}`),
    parse: (ctx, data) => {
      const email = parseEmail(ctx.text);
      if (!email) return { ok: false, error: "That email address doesn't look right. Please check it, or reply *skip*." };
      data.email = email;
      return { ok: true };
    },
    summary: (data) => (data.email ? `Email: ${data.email}` : null),
  },
  {
    key: "areas",
    label: "Areas served",
    ask: (ctx, data) => ctx.prompt(data.kind === "LANDLORD"
      ? "Where are your properties? List the areas or cities, separated by commas (e.g. *Adenta, Tema*)."
      : "Which *areas or cities* do you operate in? Separate them with commas (e.g. *East Legon, Spintex, Tema*)."),
    parse: (ctx, data) => {
      const areas = parseList(ctx.text, 30);
      if (!areas.length) return { ok: false, error: "Please list at least one area or city." };
      data.areas = areas;
      return { ok: true };
    },
    summary: (data) => (data.areas?.length ? `Areas: ${data.areas.join(", ")}` : null),
  },
  {
    key: "specialities",
    label: "Specialities",
    ask: (ctx, data) => ctx.prompt(data.kind === "LANDLORD"
      ? "What kind of properties do you own or plan to list? (e.g. *2 apartments for rent, 1 plot of land*)"
      : `Which ${BUSINESS_KINDS[data.kind!].specialityLabel} do you handle? Separate with commas (e.g. *residential rentals, land sales, commercial*).`),
    parse: (ctx, data) => {
      const items = parseList(ctx.text, 20);
      if (!items.length) return { ok: false, error: "Please list at least one, separated by commas." };
      data.specialities = items;
      return { ok: true };
    },
    summary: (data) => (data.specialities?.length ? `${data.kind === "LANDLORD" ? "Properties" : "Specialities"}: ${data.specialities.join(", ")}` : null),
  },
  {
    key: "description",
    label: "Description",
    optional: true,
    ask: (ctx, data) => ctx.prompt(`Write a short description for your public profile (a few sentences about ${isCompany(data) ? "the business" : "you"}). ${SKIP_HINT}`),
    parse: (ctx, data) => text("description", 10, 2000, "Please write at least a sentence (10–2000 characters), or *skip*.")(ctx, data),
    summary: (data) => (data.description ? `Description: ${data.description.length > 120 ? `${data.description.slice(0, 119)}…` : data.description}` : null),
  },
  {
    key: "website",
    label: "Website",
    optional: true,
    applies: isCompany,
    ask: (ctx) => ctx.prompt(`Do you have a website or social media page? Send the link. ${SKIP_HINT}`),
    parse: (ctx, data) => {
      const candidate = ctx.text.trim().replace(/^(?!https?:\/\/)/i, "https://");
      try {
        const url = new URL(candidate);
        if (!["http:", "https:"].includes(url.protocol) || !url.hostname.includes(".")) throw new Error("invalid");
        data.website = url.toString().slice(0, 2000);
        return { ok: true };
      } catch {
        return { ok: false, error: "That link doesn't look right. Please send a full web address, or *skip*." };
      }
    },
    summary: (data) => (data.website ? `Website: ${data.website}` : null),
  },
  {
    key: "affiliation",
    label: "Agency",
    optional: true,
    applies: (data) => data.kind === "AGENT",
    ask: (ctx) => ctx.prompt("Do you work with a real estate agency that is on NesAfric? Send the agency's name, or reply *skip* if you're independent."),
    parse: async (ctx, data) => {
      const name = ctx.text.trim();
      if (name.length < 2 || name.length > 200) return { ok: false, error: "Please send the agency's name, or *skip*." };
      data.affiliation = name;
      const match = await db.marketplaceProfessional.findFirst({
        where: { archivedAt: null, status: "ACTIVE", type: { not: "INDIVIDUAL_AGENT" }, OR: [{ displayName: { equals: name, mode: "insensitive" } }, { legalName: { equals: name, mode: "insensitive" } }] },
        select: { id: true },
      });
      data.affiliationProfessionalId = match?.id;
      return { ok: true };
    },
    summary: (data) => (data.affiliation ? `Agency: ${data.affiliation}${data.affiliationProfessionalId ? " (on NesAfric — they must confirm you)" : " (not found on NesAfric)"}` : null),
  },
];

async function chooseKind(ctx: Ctx) {
  ctx.step("kind");
  ctx.ask("What would you like to register?", [
    ...Object.entries(BUSINESS_KINDS).map(([key, kind]) => ({ id: `br:kind:${key}`, title: kind.title })),
    { id: "br:kind:SERVICE_BUSINESS", title: "Service business" },
    { id: "br:kind:SERVICE_INDIVIDUAL", title: "Service professional", description: "Individual tradesperson or professional" },
  ], "Business type");
}

async function showSummary(ctx: Ctx) {
  const data = ctx.data<Data>();
  ctx.step("review");
  ctx.say(`Please review your registration:\n\n*Type:* ${BUSINESS_KINDS[data.kind!].title}\n${summaryLines(FIELDS, data).join("\n")}`);
  ctx.ask("By submitting, you confirm these details are accurate and that you're authorised to register this " + (isCompany(data) ? "business." : "profile."), [
    { id: "br:submit", title: "Submit" },
    { id: "br:edit", title: "Edit details" },
    { id: "br:cancel", title: "Cancel" },
  ]);
}

async function proceed(ctx: Ctx) {
  const data = ctx.data<Data>();
  if (data.editing) {
    delete data.editing;
    return showSummary(ctx);
  }
  if (!(await askNextField(ctx, FIELDS, data))) return showSummary(ctx);
}

async function startKind(ctx: Ctx, kind: string) {
  if (kind === "SERVICE_BUSINESS" || kind === "SERVICE_INDIVIDUAL") {
    ctx.handoff = { workflow: "provider_registration", seed: { preset: kind === "SERVICE_BUSINESS" ? "COMPANY" : "INDIVIDUAL" } };
    return;
  }
  if (!(kind in BUSINESS_KINDS)) return chooseKind(ctx);
  const data = ctx.data<Data>();
  data.kind = kind as BusinessKind;
  const user = await linkedUser(ctx.contact);
  if (user) {
    const existing = await listUserMarketplaceProfessionals(user.id);
    if (existing.length) {
      ctx.say(`Note: this number is already linked to ${existing.map(({ displayName, verificationStatus }) => `*${displayName}* (${verificationStatus.toLowerCase()})`).join(", ")}. You can still register another profile.`);
    }
  }
  ctx.say(`Let's register your ${BUSINESS_KINDS[data.kind].title.toLowerCase()} profile. It takes about 2 minutes, and you can type *menu* to pause at any time.`);
  return proceed(ctx);
}

async function submit(ctx: Ctx) {
  const data = ctx.data<Data>();
  const kind = BUSINESS_KINDS[data.kind!];
  const personName = data.contactName ?? data.legalName!;
  const { user } = await ensureUserForContact(ctx.contact, personName);
  const evidence = [
    `Registered via NesAfric WhatsApp by ${personName} (${data.phone ?? ctx.contact.phoneE164 ?? ctx.contact.waId}) as: ${kind.title}`,
    ...(data.registrationNumber ? [`Business registration number: ${data.registrationNumber}`] : []),
    ...(data.affiliation ? [`States they work with agency: ${data.affiliation}${data.affiliationProfessionalId ? ` (NesAfric profile ${data.affiliationProfessionalId})` : ""}`] : []),
  ];
  // The profile, its backing organisation, the verification submission, the affiliation claim and
  // the action binding all commit in one transaction: a retry finds the binding and never
  // re-creates the profile, even when an identically named one exists.
  const outcome = await runOnce(ctx.actionKey("business_registration"), ctx.contact.id, "business_registration", async (bind) => {
    const professional = await createMarketplaceProfessional(user.id, {
      type: kind.type,
      displayName: data.brandName ?? data.legalName!,
      ...(kind.company ? { legalName: data.legalName } : {}),
      description: data.description,
      websiteUrl: data.website,
      contactEmail: data.email,
      contactPhone: data.phone,
      countryCode: "GH",
      specialities: data.specialities ?? [],
      servicesOffered: data.kind === "LANDLORD" ? ["Property owner / landlord"] : data.kind === "PROPERTY_MANAGER" ? ["Property management"] : [],
      serviceAreas: data.areas ?? [],
    }, {
      inTransaction: bind(async (tx, professionalId) => {
        await tx.marketplaceProfessional.update({ where: { id: professionalId }, data: { sourceChannel: "WHATSAPP" } });
        await submitMarketplaceVerificationInTransaction(tx, user.id, professionalId, { evidenceReferences: evidence });
        await recordEventInTx(tx, "business_registered", ctx.contact.id, { kind: data.kind, professionalId });
        if (data.affiliationProfessionalId) await recordAffiliationClaim(tx, data.affiliationProfessionalId, personName, ctx.contact.id, professionalId);
      }),
    });
    return { id: professional.id };
  });
  if (!outcome.repeated && data.affiliationProfessionalId) {
    await deliverWhatsAppNotificationNow(affiliationJob(data.affiliationProfessionalId, outcome.resultId));
  }
  ctx.say([
    `✅ Your ${kind.title.toLowerCase()} registration has been submitted.`,
    `Reference: ${referenceFor("AG", outcome.resultId)}`,
    "Status: Under review",
    "",
    "Our team will review your details and message you here when there's an update. Until then your profile shows as *not yet verified*.",
    ...(data.affiliationProfessionalId ? ["", `We've let *${data.affiliation}* know you work with them. You can list properties for them only after their administrators add you to their team.`] : []),
  ].join("\n"));
  ctx.finish();
  ctx.ask("What next?", [
    { id: "menu:list_property", title: "List a property" },
    { id: "menu:status", title: "Check status" },
    { id: "menu", title: "Main menu" },
  ]);
}

const affiliationJob = (agencyId: string, agentProfessionalId: string): WhatsAppNotificationJob => ({ kind: "affiliation_claim", agencyId, agentProfessionalId, decisionKey: agentProfessionalId });

/**
 * An agent's claim to work with an agency is never accepted on their word: it is logged for
 * NesAfric support and sent (through the outbox, in the registration's transaction) to the
 * agency's own owners/admins, who can add them through the existing team settings. The agent
 * gains no access to the agency.
 */
async function recordAffiliationClaim(tx: Prisma.TransactionClient, agencyId: string, agentName: string, contactId: string, agentProfessionalId: string) {
  const agency = await tx.marketplaceProfessional.findUnique({ where: { id: agencyId }, select: { displayName: true } });
  if (!agency) return;
  await createSupportRequest({
    contactId,
    userId: null,
    topic: "agent_affiliation",
    summary: `${agentName} (agent profile ${agentProfessionalId}) says they work with ${agency.displayName} (${agencyId}). The agency must add them to its team; no access was granted.`,
    workflow: "business_registration",
  }, tx);
  await enqueueWhatsAppNotificationInTx(tx, affiliationJob(agencyId, agentProfessionalId));
}

export const businessRegistration: Workflow = {
  key: "business_registration",

  async start(ctx: Ctx, seed: StartSeed) {
    ctx.go("business_registration", "kind", { answered: [] } satisfies Data);
    const preset = seed.preset ?? (seed.intent === "register_agent" ? "AGENT" : seed.intent === "register_landlord" ? "LANDLORD" : undefined);
    if (preset) return startKind(ctx, preset);
    if (seed.text) {
      const value = normalize(seed.text);
      if (/\bdevelop(er|ment)\b/.test(value)) return startKind(ctx, "DEVELOPER");
      if (/\bmarketing\b/.test(value)) return startKind(ctx, "MARKETING");
      if (/\bproperty manag/.test(value)) return startKind(ctx, "PROPERTY_MANAGER");
      if (/\b(agency|brokerage|broker)\b/.test(value)) return startKind(ctx, "AGENCY");
    }
    return chooseKind(ctx);
  },

  async handle(ctx: Ctx) {
    const data = ctx.data<Data>();
    const choice = ctx.choice;
    if (ctx.state.step === "kind") {
      if (choice?.startsWith("br:kind:")) return startKind(ctx, choice.slice("br:kind:".length));
      return chooseKind(ctx);
    }
    if (ctx.state.step === "review") {
      if (choice === "br:submit" || parseYesNo(ctx.text) === true) return submit(ctx);
      if (choice === "br:cancel") {
        ctx.finish();
        ctx.say("Registration cancelled — nothing was submitted.");
        return;
      }
      if (choice === "br:edit") {
        ctx.step("edit");
        ctx.ask("Which detail would you like to change?", editOptions(FIELDS, data, "br:field:"), "Details");
        return;
      }
      return showSummary(ctx);
    }
    if (ctx.state.step === "edit") {
      const key = choice?.startsWith("br:field:") ? choice.slice("br:field:".length) : undefined;
      if (!key) return showSummary(ctx);
      beginEdit(data, key);
      await askField(ctx, FIELDS, data, key);
      return;
    }
    if ((await handleFieldAnswer(ctx, FIELDS, data)) === "next") return proceed(ctx);
  },

  async reprompt(ctx: Ctx) {
    const data = ctx.data<Data>();
    if (ctx.state.step === "kind" || !data.kind) return chooseKind(ctx);
    if (ctx.state.step === "review" || ctx.state.step === "edit") return showSummary(ctx);
    return proceed(ctx);
  },
};
