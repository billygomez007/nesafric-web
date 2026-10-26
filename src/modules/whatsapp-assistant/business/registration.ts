import { z } from "zod";
import { replyButtons } from "@/modules/conversations/channels/whatsapp-interactive";
import { db } from "@/platform/database/client";
import { AppError } from "@/platform/errors";
import { createOrganisation } from "@/modules/organisations/service";
import { createMarketplaceProfessional, submitMarketplaceVerification } from "@/modules/marketplace-professionals/service";
import { createServiceProvider, submitProviderVerification } from "@/modules/providers/service";
import { uploadMarketplaceProfessionalDocument, uploadMarketplaceProfessionalLogo, uploadServiceProviderLogo } from "@/modules/documents/service";
import { applyFlowDraftChange, claimFlowDraftForSubmission, finishFlowDraft, getFlowDraft, startFlowDraft, type FlowDraft } from "./drafts";
import { advanceGuided, prefillGuided, promptFor, type GuidedFlow, type Step } from "./guided";
import { buttons, command, isSkip, numbered, paragraph, pickNumbers, region, regionPrompt, text, type FlowInput, type FlowResult } from "./common";
import { downloadWhatsAppDocument, downloadWhatsAppImage, type MediaDownloader } from "./media";

export const REGISTRATION_TYPES = ["AGENCY", "AGENT", "PROVIDER"] as const;
export type RegistrationType = (typeof REGISTRATION_TYPES)[number];

const AGENCY_TYPES = [
  { value: "REAL_ESTATE_COMPANY", label: "Real estate company" },
  { value: "BROKERAGE", label: "Brokerage" },
  { value: "DEVELOPER", label: "Property developer" },
  { value: "PROPERTY_MARKETING_COMPANY", label: "Property marketing company" },
] as const;

/** Evidence a provider names for verification: a reference NesAfric can check, never the document. */
const PROVIDER_EVIDENCE = [
  { value: "BUSINESS_REGISTRATION", label: "Business registration number" },
  { value: "PROFESSIONAL_LICENSE", label: "Professional licence" },
  { value: "TRADE_CERTIFICATE", label: "Trade certificate" },
  { value: "REFERENCE_EVIDENCE", label: "A client reference" },
] as const;

const dataSchema = z.object({
  type: z.enum(REGISTRATION_TYPES),
  agencyType: z.enum(["REAL_ESTATE_COMPANY", "BROKERAGE", "DEVELOPER", "PROPERTY_MARKETING_COMPANY"]).optional(),
  providerForm: z.enum(["INDIVIDUAL", "COMPANY"]).optional(),
  name: z.string().max(200).optional(),
  legalName: z.string().max(300).nullable().optional(),
  email: z.string().max(320).nullable().optional(),
  region: z.string().max(100).optional(),
  city: z.string().max(150).optional(),
  description: z.string().max(5000).optional(),
  serviceAreas: z.array(z.string().max(120)).max(20).optional(),
  categoryIds: z.array(z.string().uuid()).max(10).optional(),
  categoryNames: z.array(z.string().max(200)).max(10).optional(),
  evidenceType: z.enum(["BUSINESS_REGISTRATION", "PROFESSIONAL_LICENSE", "TRADE_CERTIFICATE", "REFERENCE_EVIDENCE"]).optional(),
  reference: z.string().max(500).optional(),
  logoMediaId: z.string().max(40).nullable().optional(),
  /** Verification documents, as WhatsApp media ids: uploaded privately when the person submits. */
  certificateMediaId: z.string().max(40).optional(),
  idFrontMediaId: z.string().max(40).optional(),
  idBackMediaId: z.string().max(40).optional(),
  _meta: z.record(z.string(), z.unknown()).optional(),
}).passthrough();
type Data = z.infer<typeof dataSchema>;

type DocumentField = "certificateMediaId" | "idFrontMediaId" | "idBackMediaId";

/** A required private document step: an image (or a PDF for the certificate), replaceable by sending another. */
function documentStep(id: string, label: string, when: (data: Data) => boolean, field: DocumentField, ask: string): Step<Data> {
  return {
    id, label, when, editable: true,
    prompt: (data) => ({ text: data[field] ? `${label} received. Send another to replace it, or reply done to continue.` : ask }),
    answer: (body, data) => /^(done|next|continue)$/.test(command(body)) && data[field] ? { data } : { error: `Please send the ${label.toLowerCase()} as a photo${field === "certificateMediaId" ? " or PDF" : ""}. It is needed for verification; reply pause to finish later.` },
    media: async (mediaId, data, input) => {
      const type = input.media?.mimeType?.split(";")[0].trim().toLowerCase();
      if (type && !type.startsWith("image/") && !(field === "certificateMediaId" && type === "application/pdf")) return { data, reply: `That file type can't be used. Please send the ${label.toLowerCase()} as a photo${field === "certificateMediaId" ? " or PDF" : ""}.` };
      return { data: { ...data, [field]: mediaId }, reply: `${label} received. It is stored privately when you submit.`, advance: true };
    },
    summary: (data) => `${label}: ${data[field] ? "received" : "missing"}`,
  };
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}$/;
const isProfessional = (data: Data) => data.type !== "PROVIDER";
const typeLabel = (data: Data) => data.type === "AGENCY" ? "agency registration" : data.type === "AGENT" ? "agent registration" : "service provider registration";

async function selectableCategories() {
  return db.serviceCategory.findMany({ where: { active: true, onboardingSelectable: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], take: 30, select: { id: true, name: true } });
}

const steps: Step<Data>[] = [
  {
    id: "agency_type", label: "Business type", when: (data) => data.type === "AGENCY",
    prompt: () => ({ text: `What kind of business is it? Reply with a number:\n${numbered(AGENCY_TYPES.map((item) => item.label))}` }),
    answer: (body, data) => { const pick = pickNumbers(body, AGENCY_TYPES.length, 1); return pick ? { data: { ...data, agencyType: AGENCY_TYPES[pick[0]].value } } : { error: "Please reply with one of the numbers." }; },
    summary: (data) => `Business type: ${AGENCY_TYPES.find((item) => item.value === data.agencyType)?.label ?? "-"}`,
  },
  {
    id: "provider_form", label: "Individual or company", when: (data) => data.type === "PROVIDER",
    prompt: () => ({ text: "Do you work as an individual, or as a registered company? Reply 1 for individual or 2 for company.", interactive: buttons("Do you work as an individual, or as a registered company?", [{ id: "1", title: "Individual" }, { id: "2", title: "Company" }]) }),
    answer: (body, data) => { const said = command(body); const form = said === "1" || said === "individual" ? "INDIVIDUAL" : said === "2" || said === "company" ? "COMPANY" : null; return form ? { data: { ...data, providerForm: form } } : { error: "Please reply 1 for individual or 2 for company." }; },
    summary: (data) => `Works as: ${data.providerForm === "COMPANY" ? "a company" : "an individual"}`,
  },
  {
    id: "name", label: "Name",
    prompt: (data) => ({ text: data.type === "AGENT" ? "What name should clients see on your agent profile? For example: Kofi Mensah Realty." : data.type === "AGENCY" ? "What is the business called?" : "What name should clients see for your services? For example: Kwame Plumbing Services." }),
    answer: (body, data) => { const value = text(body, 2, 200); return value ? { data: { ...data, name: value } } : { error: "Please send a name of 2 to 200 characters." }; },
    summary: (data) => `Name: ${data.name ?? "-"}`,
  },
  {
    id: "legal_name", label: "Registered (legal) name", when: (data) => data.type === "AGENCY" || data.providerForm === "COMPANY",
    prompt: (data) => ({ text: `What is the registered (legal) name of ${data.name}? Reply skip if it is the same.` }),
    answer: (body, data) => { if (isSkip(body)) return { data: { ...data, legalName: null } }; const value = text(body, 2, 300); return value ? { data: { ...data, legalName: value } } : { error: "Please send the registered name, or skip." }; },
    summary: (data) => data.legalName ? `Registered name: ${data.legalName}` : null,
  },
  {
    id: "email", label: "Business email",
    prompt: () => ({ text: "What email address should NesAfric and clients use? Reply skip to use only this WhatsApp number." }),
    answer: (body, data) => { if (isSkip(body)) return { data: { ...data, email: null } }; const value = body.trim().toLowerCase(); return EMAIL.test(value) ? { data: { ...data, email: value } } : { error: "That doesn't look like an email address. Send it again, or skip." }; },
    summary: (data) => `Email: ${data.email ?? "none (WhatsApp only)"}`,
  },
  {
    id: "region", label: "Region",
    prompt: () => ({ text: regionPrompt("are you based in") }),
    answer: (body, data) => { const value = region(body); return value ? { data: { ...data, region: value } } : { error: "Please reply with a region number or name." }; },
    summary: (data) => `Location: ${[data.city, data.region].filter(Boolean).join(", ") || "-"}`,
  },
  {
    id: "city", label: "Town or area", editable: true,
    prompt: (data) => ({ text: `Which town or area in ${data.region} are you based in? For example: East Legon.` }),
    answer: (body, data) => { const value = text(body, 2, 150); return value ? { data: { ...data, city: value } } : { error: "Please send the town or area." }; },
    summary: () => null,
  },
  {
    id: "description", label: "Description",
    prompt: (data) => ({ text: data.type === "PROVIDER" ? "Describe your services in a few sentences: what you do, your experience and the kind of jobs you take." : "Describe the business in a few sentences: what you do, the areas and property types you focus on, and your experience." }),
    answer: (body, data) => { const value = paragraph(body, 20, 2000); return value ? { data: { ...data, description: value } } : { error: "Please send at least 20 characters (at most 2,000)." }; },
    summary: (data) => `Description: ${data.description ? `${data.description.slice(0, 120)}${data.description.length > 120 ? "…" : ""}` : "-"}`,
  },
  {
    id: "service_areas", label: "Areas you cover", when: isProfessional,
    prompt: () => ({ text: "Which areas do you cover? Send them separated by commas, for example: East Legon, Cantonments, Tema." }),
    answer: (body, data) => { const areas = body.split(",").map((area) => text(area, 2, 120)).filter((area): area is string => Boolean(area)); return areas.length && areas.length <= 20 ? { data: { ...data, serviceAreas: [...new Set(areas)] } } : { error: "Please send 1 to 20 areas separated by commas." }; },
    summary: (data) => data.serviceAreas?.length ? `Areas: ${data.serviceAreas.join(", ")}` : null,
  },
  {
    id: "categories", label: "Services offered", when: (data) => data.type === "PROVIDER",
    prompt: async () => { const categories = await selectableCategories(); return { text: categories.length ? `Which services do you offer? Reply with up to 10 numbers separated by commas, for example 1, 4:\n${numbered(categories.map((category) => category.name))}` : "Service categories are not available right now. Please try again later, or reply pause." }; },
    answer: async (body, data) => {
      const categories = await selectableCategories();
      const picks = pickNumbers(body, categories.length, 10);
      return picks ? { data: { ...data, categoryIds: picks.map((pick) => categories[pick].id), categoryNames: picks.map((pick) => categories[pick].name) } } : { error: "Please reply with up to 10 numbers from the list." };
    },
    summary: (data) => data.categoryNames?.length ? `Services: ${data.categoryNames.join(", ")}` : null,
  },
  {
    id: "coverage", label: "Areas you serve", when: (data) => data.type === "PROVIDER",
    prompt: () => ({ text: "Which towns or areas do you take jobs in? Send them separated by commas, for example: Accra, Tema, Kasoa." }),
    answer: (body, data) => { const areas = body.split(",").map((area) => text(area, 2, 120)).filter((area): area is string => Boolean(area)); return areas.length && areas.length <= 20 ? { data: { ...data, serviceAreas: [...new Set(areas)] } } : { error: "Please send 1 to 20 areas separated by commas." }; },
    summary: (data) => data.serviceAreas?.length ? `Areas served: ${data.serviceAreas.join(", ")}` : null,
  },
  {
    id: "evidence_type", label: "Verification reference type", when: (data) => data.type === "PROVIDER",
    prompt: () => ({ text: `NesAfric checks every provider before approval. What can we check? Reply with a number:\n${numbered(PROVIDER_EVIDENCE.map((item) => item.label))}` }),
    answer: (body, data) => { const pick = pickNumbers(body, PROVIDER_EVIDENCE.length, 1); return pick ? { data: { ...data, evidenceType: PROVIDER_EVIDENCE[pick[0]].value } } : { error: "Please reply with one of the numbers." }; },
    summary: (data) => data.evidenceType ? `Verification: ${PROVIDER_EVIDENCE.find((item) => item.value === data.evidenceType)?.label}` : null,
  },
  {
    id: "reference", label: "Verification reference",
    prompt: (data) => ({ text: data.type === "PROVIDER"
      ? "Send the reference NesAfric can check: the number or the name and phone of the reference. Do not send photos of ID cards here."
      : data.type === "AGENCY"
        ? "NesAfric verifies every agency before listings go live. Send your business registration number (and GREDA number if you have one). Next I'll ask for a photo of the registration certificate."
        : "NesAfric verifies every agent before listings go live. Send your agent licence or GREDA number, or reply skip if you don't have one. Next I'll ask for photos of your Ghana Card." }),
    answer: (body, data) => {
      if (data.type === "AGENT" && isSkip(body)) return { data: { ...data, reference: undefined } };
      const value = text(body, 3, 300); return value ? { data: { ...data, reference: value } } : { error: "Please send a reference of 3 to 300 characters." };
    },
    summary: (data) => data.reference ? `Reference: ${data.reference}` : null,
  },
  documentStep("certificate", "Business registration certificate", (data) => data.type === "AGENCY", "certificateMediaId",
    "Send a clear photo or PDF of the business registration certificate (Registrar-General's certificate of incorporation or business name registration). Only NesAfric reviewers see it."),
  documentStep("id_front", "Ghana Card (front)", (data) => data.type === "AGENT", "idFrontMediaId",
    "Send a clear photo of the FRONT of your Ghana Card, with all four corners visible. Only NesAfric reviewers see it."),
  documentStep("id_back", "Ghana Card (back)", (data) => data.type === "AGENT", "idBackMediaId",
    "Now send a clear photo of the BACK of your Ghana Card. Only NesAfric reviewers see it."),
  {
    id: "logo", label: "Logo", editable: true,
    prompt: (data) => ({ text: data.logoMediaId ? "Logo received. Send another image to replace it, or reply done to continue." : "Send your logo as an image (JPEG, PNG or WebP, at least 64 × 64 pixels), or reply skip." }),
    answer: (body, data) => isSkip(body) ? { data: { ...data, logoMediaId: null } } : /^(done|next|continue)$/.test(command(body)) && data.logoMediaId ? { data } : { error: "Send the logo as an image, or reply skip." },
    media: async (mediaId, data) => ({ data: { ...data, logoMediaId: mediaId }, reply: "Logo received. It is uploaded when you submit.", advance: true }),
    summary: (data) => `Logo: ${data.logoMediaId ? "added" : "none"}`,
  },
];

export function registrationFlow(download?: MediaDownloader): GuidedFlow<Data> {
  return {
    what: "registration",
    steps,
    read: (raw) => dataSchema.parse(raw),
    submit: (draft, input, revision) => submitRegistration(draft, input, revision, download),
  };
}

/** Starts (or resumes) a registration of one type. The account must already be linked. */
export async function startRegistration(input: FlowInput, type: RegistrationType): Promise<FlowResult> {
  const existing = await existingBusinesses(input.userId, type);
  if (existing.length) return { reply: `${duplicateNotice(existing)}\n\nReply my applications to see their status, or menu for other options.`, exit: true };
  const { draft, created } = await startFlowDraft({ address: input.address, userId: input.userId, kind: "BUSINESS_APPLICATION", step: type === "AGENCY" ? "agency_type" : type === "PROVIDER" ? "provider_form" : "name", data: { type }, messageId: input.messageId });
  const flow = registrationFlow();
  const prompt = await promptFor(flow, draft);
  const data = dataSchema.safeParse(draft.data);
  if (!created && data.success && data.data.type !== type) return { ...prompt, reply: `You already have a ${typeLabel(data.data)} in progress. Finish or cancel it first.\n\n${prompt.reply}` };
  return created ? { ...prompt, reply: `Let's register your ${type === "AGENCY" ? "agency" : type === "AGENT" ? "agent profile" : "services"} on NesAfric. I'll ask one question at a time; reply help at any time.\n\n${prompt.reply}` } : { ...prompt, reply: `Continuing your ${typeLabel(data.success ? data.data : { type } as Data)}.\n\n${prompt.reply}` };
}

export async function continueRegistration(draft: FlowDraft, input: FlowInput, download?: MediaDownloader) {
  return advanceGuided(registrationFlow(download), draft, input);
}

type Existing = { kind: "professional" | "provider"; id: string; name: string; status: string };

/** Businesses this account already holds: a second registration of the same kind is refused. */
async function existingBusinesses(userId: string, type: RegistrationType): Promise<Existing[]> {
  if (type === "PROVIDER") {
    const providers = await db.serviceProvider.findMany({ where: { OR: [{ individualUserId: userId }, { administratorUserId: userId }] }, select: { id: true, displayName: true, verificationStatus: true } });
    return providers.map((provider) => ({ kind: "provider", id: provider.id, name: provider.displayName, status: provider.verificationStatus }));
  }
  const members = await db.marketplaceProfessionalMember.findMany({ where: { userId, status: "ACTIVE", role: { in: ["OWNER", "ADMIN"] }, marketplaceProfessional: { archivedAt: null } }, select: { marketplaceProfessional: { select: { id: true, displayName: true, verificationStatus: true } } } });
  return members.map(({ marketplaceProfessional: professional }) => ({ kind: "professional", id: professional.id, name: professional.displayName, status: professional.verificationStatus }));
}

const duplicateNotice = (existing: Existing[]) => `This account already manages ${existing.map((item) => `${item.name} (${statusLabel(item.status)})`).join(", ")}. To avoid duplicate businesses, a second one can't be registered here. Manage it, or add team members, on the website.`;

/** Plain-language status of an application. */
export function statusLabel(status: string) {
  switch (status) {
    case "UNVERIFIED": return "saved, not yet submitted";
    case "PENDING": return "submitted for review";
    case "VERIFIED": return "approved";
    case "REQUIRES_MORE_INFORMATION": return "changes requested";
    case "REJECTED": return "rejected";
    case "SUSPENDED": return "suspended";
    default: return status.toLowerCase();
  }
}

async function submitRegistration(draft: FlowDraft, input: FlowInput, revision: number, download?: MediaDownloader): Promise<FlowResult> {
  const data = dataSchema.parse(draft.data);
  if (!await claimFlowDraftForSubmission(draft.id, input.userId, "review", revision, input.messageId)) {
    const latest = await getFlowDraft(draft.id, input.userId);
    if (latest?.status === "SUBMITTED") return { reply: "This registration was already submitted. Reply my applications to see its status.", exit: true };
    if (latest?.status === "OPEN" && latest.step === "review") {
      const prompt = await promptFor(registrationFlow(), latest);
      return { ...prompt, reply: `Your registration changed after you reviewed it, so nothing was submitted. Please check it again.\n\n${prompt.reply}` };
    }
    return latest ? promptFor(registrationFlow(), latest) : { reply: "This registration is no longer open. Reply menu to start again.", exit: true };
  }
  try {
    const outcome = data.type === "PROVIDER" ? await submitProvider(draft, data, input, download) : await submitProfessional(draft, data, input, download);
    return outcome;
  } catch (error) {
    // Nothing is lost: the draft goes back to review and keeps any record already created.
    await finishFlowDraft(draft.id, { status: "OPEN", step: "review" });
    const reason = error instanceof AppError && error.status < 500 ? error.message : "Something went wrong while submitting.";
    return { reply: `${reason} Your answers are saved; reply confirm to try again, or edit to change something.`, draftId: draft.id };
  }
}

/** Finds a business this draft created earlier (a retried submission adopts it, never duplicates). */
async function adopt(draft: FlowDraft, existing: Existing[], name: string) {
  return existing.find((item) => item.id === (draft.marketplaceProfessionalId ?? draft.serviceProviderId)) ?? existing.find((item) => item.name === name) ?? null;
}

async function uploadLogo(mediaId: string | null | undefined, upload: (file: { fileName: string; contentType: string; dataBase64: string }) => Promise<unknown>, download?: MediaDownloader) {
  if (!mediaId) return "none";
  const file = await downloadWhatsAppImage(mediaId, download);
  if (!file) return "failed";
  try {
    await upload({ fileName: `logo-${mediaId}.${file.contentType.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg"}`, contentType: file.contentType, dataBase64: file.body.toString("base64") });
    return "uploaded";
  } catch (error) {
    if (error instanceof AppError && error.status < 500) return "failed";
    throw error;
  }
}

const REQUIRED_DOCUMENTS: Record<"AGENCY" | "AGENT", Array<{ field: DocumentField; type: "BUSINESS_REGISTRATION_CERTIFICATE" | "GHANA_CARD_FRONT" | "GHANA_CARD_BACK"; label: string }>> = {
  AGENCY: [{ field: "certificateMediaId", type: "BUSINESS_REGISTRATION_CERTIFICATE", label: "business registration certificate" }],
  AGENT: [{ field: "idFrontMediaId", type: "GHANA_CARD_FRONT", label: "front of your Ghana Card" }, { field: "idBackMediaId", type: "GHANA_CARD_BACK", label: "back of your Ghana Card" }],
};

/** Stores each verification document once per profile (a retried submission skips what is saved). */
async function uploadDocuments(data: Data, userId: string, professionalId: string, download?: MediaDownloader) {
  const failed: string[] = [];
  for (const document of REQUIRED_DOCUMENTS[data.type as "AGENCY" | "AGENT"] ?? []) {
    const mediaId = data[document.field];
    if (!mediaId) { failed.push(document.label); continue; }
    const sourceMediaId = `whatsapp:${mediaId}`;
    if (await db.marketplaceProfessionalDocument.findUnique({ where: { marketplaceProfessionalId_sourceMediaId: { marketplaceProfessionalId: professionalId, sourceMediaId } }, select: { id: true } })) continue;
    const file = await downloadWhatsAppDocument(mediaId, download);
    if (!file) { failed.push(document.label); continue; }
    const extension = file.contentType === "application/pdf" ? "pdf" : file.contentType.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
    try {
      await uploadMarketplaceProfessionalDocument(userId, professionalId, { fileName: `${document.type.toLowerCase()}-${mediaId}.${extension}`, contentType: file.contentType, dataBase64: file.body.toString("base64"), professionalDocumentType: document.type, sourceMediaId });
    } catch (error) {
      if (error instanceof AppError && error.status < 500) { failed.push(document.label); continue; }
      throw error;
    }
  }
  return failed;
}

async function submitProfessional(draft: FlowDraft, data: Data, input: FlowInput, download?: MediaDownloader): Promise<FlowResult> {
  const missing = (REQUIRED_DOCUMENTS[data.type as "AGENCY" | "AGENT"] ?? []).filter((document) => !data[document.field]);
  if (missing.length) {
    await finishFlowDraft(draft.id, { status: "OPEN", step: missing[0].field === "certificateMediaId" ? "certificate" : missing[0].field === "idFrontMediaId" ? "id_front" : "id_back" });
    return { reply: `Before submitting, please send the ${missing.map((item) => item.label).join(" and ")}. Reply resume to continue.`, draftId: draft.id };
  }
  const existing = await existingBusinesses(input.userId, data.type);
  let target = await adopt(draft, existing, data.name!);
  if (!target && existing.length) {
    await finishFlowDraft(draft.id, { status: "CANCELLED", step: "duplicate" });
    return { reply: duplicateNotice(existing), exit: true };
  }
  if (!target) {
    const created = await createMarketplaceProfessional(input.userId, {
      type: data.type === "AGENT" ? "INDIVIDUAL_AGENT" : data.agencyType ?? "REAL_ESTATE_COMPANY",
      displayName: data.name,
      legalName: data.legalName ?? undefined,
      description: data.description,
      contactEmail: data.email ?? undefined,
      contactPhone: input.address,
      countryCode: "GH",
      serviceAreas: [...new Set([...(data.serviceAreas ?? []), [data.city, data.region].filter(Boolean).join(", ")])].slice(0, 50),
    }) as { id: string; displayName: string };
    target = { kind: "professional", id: created.id, name: created.displayName, status: "UNVERIFIED" };
    await db.whatsAppFlowDraft.update({ where: { id: draft.id }, data: { marketplaceProfessionalId: created.id } });
  }
  const logo = await uploadLogo(data.logoMediaId, (file) => uploadMarketplaceProfessionalLogo(input.userId, target!.id, file), download);
  const failedDocuments = await uploadDocuments(data, input.userId, target.id, download);
  if (failedDocuments.length) {
    // The profile exists (and is adopted on retry); the person sends the document again.
    const field = REQUIRED_DOCUMENTS[data.type as "AGENCY" | "AGENT"].find((item) => failedDocuments.includes(item.label))!.field;
    await finishFlowDraft(draft.id, { status: "OPEN", step: field === "certificateMediaId" ? "certificate" : field === "idFrontMediaId" ? "id_front" : "id_back", data: { ...data, [field]: undefined } });
    return { reply: `I could not save the ${failedDocuments.join(" and ")}. Please send it again as a clear photo${field === "certificateMediaId" ? " or PDF" : ""}, then reply confirm.`, draftId: draft.id };
  }
  const current = await db.marketplaceProfessional.findUniqueOrThrow({ where: { id: target.id }, select: { verificationStatus: true } });
  if (current.verificationStatus === "UNVERIFIED" || current.verificationStatus === "REJECTED") {
    const documents = REQUIRED_DOCUMENTS[data.type as "AGENCY" | "AGENT"].map((item) => item.label);
    await submitMarketplaceVerification(input.userId, target.id, { evidenceReferences: [`Submitted on WhatsApp${data.reference ? `: ${data.reference}` : ""}`, `Documents uploaded: ${documents.join(", ")}`] });
  }
  await finishFlowDraft(draft.id, { status: "SUBMITTED", step: "submitted", targets: { marketplaceProfessionalId: target.id } });
  const reply = [
    `✅ ${target.name} is submitted for review.`,
    logo === "failed" ? "Your logo could not be saved; you can send it again later." : logo === "uploaded" ? "Your logo is saved." : null,
    "Your documents are stored privately for NesAfric's review. You can prepare your property listings now; they are submitted for review once your registration is approved. Reply my applications to check the status.",
  ].filter(Boolean).join("\n");
  return { reply, interactive: replyButtons(reply, [{ id: "list a property", title: "List a property" }, { id: "my applications", title: "My applications" }]), exit: true };
}

async function submitProvider(draft: FlowDraft, data: Data, input: FlowInput, download?: MediaDownloader): Promise<FlowResult> {
  const existing = await existingBusinesses(input.userId, "PROVIDER");
  let target = await adopt(draft, existing, data.name!);
  if (!target && existing.length) {
    await finishFlowDraft(draft.id, { status: "CANCELLED", step: "duplicate" });
    return { reply: duplicateNotice(existing), exit: true };
  }
  if (!target) {
    let companyOrganisationId = draft.organisationId ?? undefined;
    if (data.providerForm === "COMPANY" && !companyOrganisationId) {
      const organisation = await createOrganisation(input.userId, { name: data.legalName ?? data.name, type: "OTHER", countryCode: "GH" }, { skipSubscription: true });
      companyOrganisationId = organisation.id;
      await db.whatsAppFlowDraft.update({ where: { id: draft.id }, data: { organisationId: companyOrganisationId } });
    }
    const created = await createServiceProvider(input.userId, {
      type: data.providerForm === "COMPANY" ? "COMPANY" : "INDIVIDUAL",
      ...(data.providerForm === "COMPANY" ? { companyOrganisationId } : {}),
      displayName: data.name,
      legalName: data.legalName ?? undefined,
      contactEmail: data.email ?? undefined,
      contactPhone: input.address,
      biography: data.description,
      categoryIds: data.categoryIds ?? [],
      serviceAreas: (data.serviceAreas ?? []).map((name) => ({ areaType: "CITY", name, reference: data.region })),
    }) as { id: string; displayName: string };
    target = { kind: "provider", id: created.id, name: created.displayName, status: "UNVERIFIED" };
    await db.whatsAppFlowDraft.update({ where: { id: draft.id }, data: { serviceProviderId: created.id } });
  }
  const logo = await uploadLogo(data.logoMediaId, (file) => uploadServiceProviderLogo(input.userId, target!.id, file), download);
  const current = await db.serviceProvider.findUniqueOrThrow({ where: { id: target.id }, select: { verificationStatus: true } });
  if (["UNVERIFIED", "REJECTED", "REQUIRES_MORE_INFORMATION"].includes(current.verificationStatus)) {
    await submitProviderVerification(input.userId, target.id, { evidence: [{ type: data.evidenceType ?? "REFERENCE_EVIDENCE", reference: data.reference }] });
  }
  await finishFlowDraft(draft.id, { status: "SUBMITTED", step: "submitted", targets: { serviceProviderId: target.id } });
  return {
    reply: [
      `${target.name} is submitted for review. Status: submitted for review.`,
      logo === "failed" ? "Your logo could not be saved; you can send it again later." : logo === "uploaded" ? "Your logo is saved." : null,
      "Once NesAfric approves you, reply list my services to publish your service listing with prices and photos. You can prepare it now; it goes live after approval.",
    ].filter(Boolean).join("\n"),
    exit: true,
  };
}

/** "my applications": every business and open draft for this account, with plain statuses. */
export async function applicationsSummary(userId: string, address: string) {
  const [professionals, providers, drafts] = await Promise.all([
    existingBusinesses(userId, "AGENCY"),
    existingBusinesses(userId, "PROVIDER"),
    db.whatsAppFlowDraft.findMany({ where: { userId, address, status: "OPEN" }, select: { kind: true, step: true } }),
  ]);
  const lines = [
    ...professionals.map((item) => `${item.name}: ${statusLabel(item.status)}`),
    ...providers.map((item) => `${item.name} (services): ${statusLabel(item.status)}`),
    ...drafts.map((item) => `${item.kind === "BUSINESS_APPLICATION" ? "Business registration" : item.kind === "PROPERTY_LISTING" ? "Property listing" : "Service listing"}: saved draft (reply resume)`),
  ];
  return lines.length ? `Your NesAfric applications:\n${lines.map((line) => `• ${line}`).join("\n")}` : "You have no business applications yet. Reply menu to register one.";
}

/** Agency types and the individual agent, as Agent Registration Flow options. */
export const REGISTRATION_FLOW_KINDS = [
  ...AGENCY_TYPES.map((item, index) => ({ id: `AGENCY:${index + 1}`, title: item.label })),
  { id: "AGENT", title: "Individual agent" },
];

/**
 * Starts an agency or agent registration from Agent Registration Flow answers. Each answer goes
 * through its chat step; the chat then asks for the verification documents (certificate, or the
 * Ghana Card front and back), the logo and the review, exactly as a typed registration.
 */
export async function startRegistrationFromFlow(input: FlowInput, kind: string, answers: Record<string, string>): Promise<{ error: string; step: string } | { draftId: string; reply: string }> {
  const type: "AGENCY" | "AGENT" | null = kind.startsWith("AGENCY:") ? "AGENCY" : kind === "AGENT" ? "AGENT" : null;
  if (!type) return { error: "Please choose what you are registering.", step: "kind" };
  const existing = await existingBusinesses(input.userId, type);
  if (existing.length) return { error: duplicateNotice(existing), step: "kind" };
  const { draft, created } = await startFlowDraft({ address: input.address, userId: input.userId, kind: "BUSINESS_APPLICATION", step: type === "AGENCY" ? "agency_type" : "name", data: { type }, messageId: input.messageId });
  if (!created && dataSchema.safeParse(draft.data).data?.type !== type) return { error: "You already have another registration in progress. Reply resume in the chat to finish or cancel it.", step: "kind" };
  const flow = registrationFlow();
  const prefilled = await prefillGuided(flow, flow.read({ type }), { ...(type === "AGENCY" ? { agency_type: kind.split(":")[1] } : {}), ...answers }, input);
  const [field, message] = Object.entries(prefilled.errors)[0] ?? [];
  if (field) return { error: message, step: field };
  const result = await applyFlowDraftChange(draft.id, input.userId, `${input.messageId}:answers`, () => ({ step: prefilled.step, data: prefilled.data as Record<string, unknown> }));
  if (!result.draft) return { error: "This registration is no longer open.", step: "kind" };
  const prompt = await promptFor(flow, result.draft);
  return { draftId: draft.id, reply: prompt.reply };
}
