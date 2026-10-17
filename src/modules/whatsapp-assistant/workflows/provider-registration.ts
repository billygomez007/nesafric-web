import { uploadProviderEvidenceDocument, uploadServiceProviderLogo } from "@/modules/documents/service";
import { updateMarketplaceProfile } from "@/modules/marketplace/service";
import { createOrganisation } from "@/modules/organisations/service";
import { createServiceProvider, submitProviderVerification } from "@/modules/providers/service";
import { db } from "@/platform/database/client";
import { AppError } from "@/platform/errors";
import { formatPhoneForDisplay, normalizePhone } from "@/platform/identity/phone";
import { runOnce, sinceStart } from "../actions";
import type { Ctx, StartSeed, Workflow } from "../context";
import { askField, askNextField, beginEdit, editOptions, handleFieldAnswer, SKIP_HINT, summaryLines, type FieldSpec, type FormData } from "../form";
import { ensureUserForContact } from "../identity";
import { fetchInboundMedia, uploadFailureMessage } from "../media";
import { detectCommand, parseEmail, parseList, parseLocation, parseYesNo, type ParsedLocation } from "../nlu";
import { referenceFor } from "../references";
import { matchServiceCategory, publicServiceCategories } from "../service-categories";
import { recordEvent } from "../store";
import { errorLabel } from "../log";

/**
 * Service-provider onboarding through WhatsApp, using the same provider, marketplace-profile,
 * evidence-upload and verification services as the website. A WhatsApp-registered profile stays
 * unlisted (`listed: false`) until a NesAfric reviewer approves the provider's identity; the
 * approval hook then lists it (see `notifications.ts`).
 */
type Data = FormData & {
  providerType?: "INDIVIDUAL" | "COMPANY";
  displayName?: string;
  contactName?: string;
  categories?: Array<{ id: string; name: string }>;
  areas?: ParsedLocation[];
  description?: string;
  experience?: string;
  email?: string;
  phone?: string;
  phoneConfirmed?: boolean;
  providerId?: string;
  evidence?: Array<{ type: string; reference: string }>;
  logoSaved?: boolean;
};

const isCompany = (data: Data) => data.providerType === "COMPANY";

const FIELDS: FieldSpec<Data>[] = [
  {
    key: "displayName",
    label: "Name",
    ask: (ctx, data) => ctx.prompt(isCompany(data) ? "What is the *business name*?" : "What is your *full name* (or the name you trade under)?"),
    parse: (ctx, data) => {
      const value = ctx.text.replace(/\s+/g, " ").trim();
      if (value.length < 2 || value.length > 200) return { ok: false, error: "Please send a name between 2 and 200 characters." };
      data.displayName = value;
      return { ok: true };
    },
    summary: (data) => `Name: ${data.displayName}`,
  },
  {
    key: "contactName",
    label: "Contact person",
    applies: isCompany,
    ask: (ctx) => ctx.prompt("Who is the *main contact person*? (full name)"),
    parse: (ctx, data) => {
      const value = ctx.text.trim();
      if (value.length < 2 || value.length > 160) return { ok: false, error: "Please send the contact person's full name." };
      data.contactName = value;
      return { ok: true };
    },
    summary: (data) => (data.contactName ? `Contact: ${data.contactName}` : null),
  },
  {
    key: "categories",
    label: "Services",
    ask: (ctx) => ctx.prompt("Which *services* do you offer? Separate them with commas, e.g. *plumbing, borehole drilling, water tanks*."),
    parse: async (ctx, data) => {
      const categories = await publicServiceCategories();
      const parts = parseList(ctx.text, 10);
      const matched = new Map<string, { id: string; name: string }>();
      const unmatched: string[] = [];
      for (const part of parts) {
        const category = matchServiceCategory(part, categories);
        if (category && category.parentName) matched.set(category.id, { id: category.id, name: category.name });
        else unmatched.push(part);
      }
      if (!matched.size) return { ok: false, error: "I couldn't match those to services NesAfric lists. Try simpler words, e.g. *plumbing*, *electrical*, *cleaning*, *painting*." };
      data.categories = [...matched.values()];
      if (unmatched.length) ctx.say(`I couldn't match: ${unmatched.join(", ")}. You can add them later from your NesAfric profile.`);
      return { ok: true };
    },
    summary: (data) => (data.categories?.length ? `Services: ${data.categories.map(({ name }) => name).join(", ")}` : null),
  },
  {
    key: "areas",
    label: "Areas served",
    ask: (ctx) => ctx.prompt("Which *areas or cities* do you serve? Separate with commas, e.g. *Spintex, Tema, East Legon*."),
    parse: (ctx, data) => {
      const areas = parseList(ctx.text, 20).map((part) => parseLocation(part, true)).filter((area): area is ParsedLocation => Boolean(area));
      if (!areas.length) return { ok: false, error: "Please list at least one area or city." };
      data.areas = areas;
      return { ok: true };
    },
    summary: (data) => (data.areas?.length ? `Areas: ${data.areas.map(({ label }) => label).join("; ")}` : null),
  },
  {
    key: "description",
    label: "Description",
    ask: (ctx, data) => ctx.prompt(`Describe ${isCompany(data) ? "the business" : "your work"} in a few sentences — this appears on your public profile.`),
    parse: (ctx, data) => {
      const value = ctx.text.trim();
      if (value.length < 10 || value.length > 2000) return { ok: false, error: "Please write at least a sentence (10–2000 characters)." };
      data.description = value;
      return { ok: true };
    },
    summary: (data) => (data.description ? `Description: ${data.description.length > 120 ? `${data.description.slice(0, 119)}…` : data.description}` : null),
  },
  {
    key: "experience",
    label: "Experience",
    optional: true,
    ask: (ctx) => ctx.prompt(`Any *experience, qualifications or licences* to mention? (e.g. *10 years, City & Guilds certificate*) ${SKIP_HINT}`),
    parse: (ctx, data) => {
      const value = ctx.text.trim();
      if (value.length < 2 || value.length > 1000) return { ok: false, error: "Please keep it under 1000 characters, or *skip*." };
      data.experience = value;
      return { ok: true };
    },
    summary: (data) => (data.experience ? `Experience: ${data.experience}` : null),
  },
  {
    key: "phone",
    label: "Phone",
    ask: (ctx, data) => {
      if (data.phoneConfirmed === false) return ctx.prompt("Please type the phone number to use, e.g. *024 123 4567*.");
      ctx.ask(`Should customers reach you on *${formatPhoneForDisplay(ctx.contact.phoneE164 ?? `+${ctx.contact.waId}`)}* (this WhatsApp number)?`, [
        { id: "pr:phone:yes", title: "Yes, use this" },
        { id: "pr:phone:other", title: "Use another" },
      ]);
    },
    parse: (ctx, data) => {
      if (ctx.choice === "pr:phone:yes" || (data.phoneConfirmed !== false && parseYesNo(ctx.text) === true)) {
        data.phone = ctx.contact.phoneE164 ?? `+${ctx.contact.waId}`;
        delete data.phoneConfirmed;
        return { ok: true };
      }
      if (ctx.choice === "pr:phone:other" || (data.phoneConfirmed !== false && parseYesNo(ctx.text) === false)) {
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
    ask: (ctx) => ctx.prompt(`What email address should we use? ${SKIP_HINT}`),
    parse: (ctx, data) => {
      const email = parseEmail(ctx.text);
      if (!email) return { ok: false, error: "That email address doesn't look right. Please check it, or reply *skip*." };
      data.email = email;
      return { ok: true };
    },
    summary: (data) => (data.email ? `Email: ${data.email}` : null),
  },
];

async function chooseType(ctx: Ctx) {
  ctx.step("type");
  ctx.ask("Is this an individual service profile or a registered business?", [
    { id: "pr:type:INDIVIDUAL", title: "Individual" },
    { id: "pr:type:COMPANY", title: "Registered business" },
  ]);
}

async function showSummary(ctx: Ctx) {
  const data = ctx.data<Data>();
  ctx.step("review");
  ctx.say(`Please review your service profile:\n\n*Type:* ${isCompany(data) ? "Registered business" : "Individual professional"}\n${summaryLines(FIELDS, data).join("\n")}`);
  ctx.ask("By submitting you confirm these details are accurate. Your profile stays private until NesAfric verifies it.", [
    { id: "pr:submit", title: "Submit" },
    { id: "pr:edit", title: "Edit details" },
    { id: "pr:cancel", title: "Cancel" },
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

function askIdDocument(ctx: Ctx) {
  ctx.step("doc:id");
  ctx.prompt(`To be verified, NesAfric needs a clear photo of ${ctx.data<Data>().providerType === "COMPANY" ? "the contact person's" : "your"} *Ghana Card (front)*. Send it now as a photo or PDF, or reply *later*.\n\n🔒 It is stored privately and only NesAfric's verification team can see it.`, "media");
}

function askBusinessDocument(ctx: Ctx) {
  ctx.step("doc:business");
  ctx.prompt("Please send your *business registration certificate* (photo or PDF), or reply *later*.", "media");
}

function askLogo(ctx: Ctx) {
  ctx.step("doc:logo");
  ctx.prompt("Finally, send a *logo or profile photo* for your public profile, or reply *skip*.", "media");
}

async function submit(ctx: Ctx) {
  const data = ctx.data<Data>();
  const { user } = await ensureUserForContact(ctx.contact, data.contactName ?? data.displayName!);
  if (data.providerType === "INDIVIDUAL") {
    const existing = await db.serviceProvider.findUnique({ where: { individualUserId: user.id }, select: { id: true, displayName: true } });
    if (existing) {
      ctx.say(`You already have an individual service profile: *${existing.displayName}* (${referenceFor("SV", existing.id)}). Reply *status* to check it, or register a business instead.`);
      return ctx.finish();
    }
  }
  const outcome = await runOnce(ctx.actionKey("provider_registration"), ctx.contact.id, "provider_registration", async () => {
    const companyOrganisationId = isCompany(data)
      ? (await createOrganisation(user.id, { name: data.displayName!, type: "OTHER", countryCode: "GH" })).id
      : undefined;
    const provider = await createServiceProvider(user.id, {
      type: data.providerType,
      companyOrganisationId,
      displayName: data.displayName,
      contactEmail: data.email,
      contactPhone: data.phone,
      biography: [data.description, data.experience ? `Experience & qualifications: ${data.experience}` : null].filter(Boolean).join("\n\n"),
      categoryIds: data.categories!.map(({ id }) => id),
      serviceAreas: data.areas!.map((area) => ({ areaType: "SERVICE_AREA", name: [area.area, area.city, area.region, "GH"].filter(Boolean).join(", ") })),
    });
    await db.serviceProvider.update({ where: { id: provider.id }, data: { sourceChannel: "WHATSAPP" } });
    try {
      // Explicit categories and areas for the public profile, but unlisted until NesAfric approves.
      await updateMarketplaceProfile(user.id, provider.id, {
        listed: false,
        publicDescription: data.description,
        categoryIds: data.categories!.map(({ id }) => id),
        serviceAreas: dedupeAreas(data.areas!).map((area) => ({ countryCode: "GH", region: area.region, city: area.city, district: area.area, label: area.label })),
      });
    } catch (error) {
      console.error("[whatsapp-assistant] marketplace profile setup failed", { providerId: provider.id, error: errorLabel(error) });
    }
    return { id: provider.id };
  }, async (startedAt) => {
    const found = await db.serviceProvider.findFirst({
      where: { administratorUserId: user.id, displayName: data.displayName!, createdAt: { gte: sinceStart(startedAt) } },
      select: { id: true },
    });
    if (found) await db.serviceProvider.update({ where: { id: found.id }, data: { sourceChannel: "WHATSAPP" } });
    return found?.id ?? null;
  });
  if (!outcome.repeated) await recordEvent("provider_registered", ctx.contact.id, { providerId: outcome.resultId, type: data.providerType });
  data.providerId = outcome.resultId;
  data.evidence = [];
  ctx.say(`✅ Your service profile has been saved (not public yet).\nReference: ${referenceFor("SV", outcome.resultId)}`);
  askIdDocument(ctx);
}

function dedupeAreas(areas: ParsedLocation[]) {
  const seen = new Set<string>();
  return areas.filter((area) => {
    const key = [area.region, area.city, area.area].map((part) => part?.toLowerCase() ?? "").join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function saveEvidence(ctx: Ctx, evidenceType: "GHANA_CARD_FRONT" | "BUSINESS_REGISTRATION") {
  const data = ctx.data<Data>();
  const media = ctx.input.media!;
  if (!["image", "document"].includes(media.kind)) {
    ctx.say("Please send a photo or a PDF document.");
    return false;
  }
  const fetched = await fetchInboundMedia(ctx.contact.id, media, "provider_evidence");
  if (!fetched.ok) {
    ctx.say(fetched.message);
    return false;
  }
  try {
    const result = await uploadProviderEvidenceDocument(ctx.contact.userId!, data.providerId!, { ...fetched.payload, evidenceType }) as { storageObject: { storageKey: string } };
    data.evidence = [...(data.evidence ?? []), { type: evidenceType, reference: result.storageObject.storageKey }];
    return true;
  } catch (error) {
    ctx.say(await uploadFailureMessage(ctx.contact.id, "provider_evidence", error));
    return false;
  }
}

async function finishDocuments(ctx: Ctx) {
  const data = ctx.data<Data>();
  let submitted = false;
  if (data.evidence?.length) {
    try {
      await submitProviderVerification(ctx.contact.userId!, data.providerId!, { evidence: data.evidence });
      submitted = true;
    } catch (error) {
      if (!(error instanceof AppError && error.code === "INVALID_VERIFICATION_STATE")) throw error;
      submitted = true; // Already submitted (e.g. a repeated message): nothing more to do.
    }
  }
  await recordEvent("provider_documents", ctx.contact.id, { providerId: data.providerId, documents: data.evidence?.length ?? 0, logo: Boolean(data.logoSaved) });
  ctx.say(submitted
    ? `✅ Thank you! Your profile and documents are with NesAfric's verification team.\nReference: ${referenceFor("SV", data.providerId!)}\nStatus: Under review\n\nYour profile becomes public once it's approved — I'll message you here.`
    : `Your profile is saved (${referenceFor("SV", data.providerId!)}) but it can't be verified or made public until you send your Ghana Card. Reply *status* anytime, or finish verification on the NesAfric website.`);
  ctx.finish();
}

export const providerRegistration: Workflow = {
  key: "provider_registration",

  async start(ctx: Ctx, seed: StartSeed) {
    ctx.go("provider_registration", "type", { answered: [] } satisfies Data);
    if (seed.preset === "INDIVIDUAL" || seed.preset === "COMPANY") {
      ctx.data<Data>().providerType = seed.preset;
      ctx.say("Let's set up your NesAfric service profile. It takes about 3 minutes; type *menu* to pause anytime.");
      return proceed(ctx);
    }
    return chooseType(ctx);
  },

  async handle(ctx: Ctx) {
    const data = ctx.data<Data>();
    const choice = ctx.choice;
    const step = ctx.state.step;
    if (step === "type") {
      if (choice === "pr:type:INDIVIDUAL" || choice === "pr:type:COMPANY") return providerRegistration.start(ctx, { preset: choice.slice("pr:type:".length) });
      return chooseType(ctx);
    }
    if (step === "review") {
      if (choice === "pr:submit" || parseYesNo(ctx.text) === true) return submit(ctx);
      if (choice === "pr:cancel") {
        ctx.finish();
        ctx.say("Registration cancelled — nothing was submitted.");
        return;
      }
      if (choice === "pr:edit") {
        ctx.step("edit");
        ctx.ask("Which detail would you like to change?", editOptions(FIELDS, data, "pr:field:"), "Details");
        return;
      }
      return showSummary(ctx);
    }
    if (step === "edit") {
      const key = choice?.startsWith("pr:field:") ? choice.slice("pr:field:".length) : undefined;
      if (!key) return showSummary(ctx);
      beginEdit(data, key);
      await askField(ctx, FIELDS, data, key);
      return;
    }
    if (step === "doc:id" || step === "doc:business") {
      const later = !ctx.input.media && ["skip", "done"].includes(detectCommand(ctx.text) ?? "") || /^later$/i.test(ctx.text);
      if (!later) {
        if (!ctx.input.media) return providerRegistration.reprompt(ctx);
        if (!(await saveEvidence(ctx, step === "doc:id" ? "GHANA_CARD_FRONT" : "BUSINESS_REGISTRATION"))) return;
        ctx.say("📄 Document received and stored securely.");
      }
      if (step === "doc:id" && isCompany(data)) return askBusinessDocument(ctx);
      return askLogo(ctx);
    }
    if (step === "doc:logo") {
      if (ctx.input.media) {
        if (ctx.input.media.kind !== "image") {
          ctx.say("Please send the logo as a photo (JPG or PNG), or reply *skip*.");
          return;
        }
        const fetched = await fetchInboundMedia(ctx.contact.id, ctx.input.media, "provider_logo");
        if (!fetched.ok) return ctx.say(fetched.message);
        try {
          await uploadServiceProviderLogo(ctx.contact.userId!, data.providerId!, fetched.payload);
          data.logoSaved = true;
        } catch (error) {
          ctx.say(await uploadFailureMessage(ctx.contact.id, "provider_logo", error));
          return;
        }
      } else if (!["skip", "done"].includes(detectCommand(ctx.text) ?? "") && !/^later$/i.test(ctx.text)) {
        return providerRegistration.reprompt(ctx);
      }
      return finishDocuments(ctx);
    }
    if ((await handleFieldAnswer(ctx, FIELDS, data)) === "next") return proceed(ctx);
  },

  async reprompt(ctx: Ctx) {
    const data = ctx.data<Data>();
    switch (ctx.state.step) {
      case "type":
        return chooseType(ctx);
      case "review":
      case "edit":
        return showSummary(ctx);
      case "doc:id":
        return askIdDocument(ctx);
      case "doc:business":
        return askBusinessDocument(ctx);
      case "doc:logo":
        return askLogo(ctx);
      default:
        if (!data.providerType) return chooseType(ctx);
        return proceed(ctx);
    }
  },
};
