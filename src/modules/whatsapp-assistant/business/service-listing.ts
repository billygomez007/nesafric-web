import { z } from "zod";
import { db } from "@/platform/database/client";
import { AppError } from "@/platform/errors";
import { absoluteUrl } from "@/platform/brand";
import { MAX_PROVIDER_PORTFOLIO_IMAGES } from "@/lib/listing-media-rules";
import { ownsProvider, updateServiceProvider } from "@/modules/providers/service";
import { updateMarketplaceProfile } from "@/modules/marketplace/service";
import { removeProviderPortfolioImage } from "@/modules/documents/service";
import { claimFlowDraftForSubmission, finishFlowDraft, getFlowDraft, startFlowDraft, type FlowDraft } from "./drafts";
import { advanceGuided, promptFor, type GuidedFlow, type Step } from "./guided";
import { amountMinor, buttons, command, formatMinor, numbered, paragraph, pickNumbers, region, regionPrompt, text, type FlowInput, type FlowResult } from "./common";
import { addPortfolioImage, type MediaDownloader } from "./media";
import { statusLabel } from "./registration";

const PRICING = [
  { value: "FIXED", label: "A fixed price" },
  { value: "STARTING_FROM", label: "A starting price (from …)" },
  { value: "QUOTE", label: "Quote on request" },
] as const;
const AVAILABILITY = [
  { value: "AVAILABLE", label: "Taking new jobs" },
  { value: "LIMITED", label: "Limited availability" },
  { value: "UNAVAILABLE", label: "Not taking jobs right now" },
] as const;

const dataSchema = z.object({
  providerId: z.string().uuid(),
  providerName: z.string().max(200),
  categoryChoices: z.array(z.object({ id: z.string().uuid(), name: z.string().max(200) })).max(30).default([]),
  categoryIds: z.array(z.string().uuid()).max(10).optional(),
  categoryNames: z.array(z.string().max(200)).max(10).optional(),
  region: z.string().max(100).optional(),
  areas: z.array(z.string().max(120)).max(20).optional(),
  description: z.string().max(5000).optional(),
  pricingModel: z.enum(["FIXED", "STARTING_FROM", "QUOTE"]).optional(),
  priceMinor: z.string().regex(/^\d{1,16}$/).nullable().optional(),
  availability: z.enum(["AVAILABLE", "LIMITED", "UNAVAILABLE"]).optional(),
  _photosDone: z.boolean().optional(),
  _meta: z.record(z.string(), z.unknown()).optional(),
}).passthrough();
type Data = z.infer<typeof dataSchema>;

const portfolio = (providerId: string) => db.providerPortfolioImage.findMany({ where: { providerId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { id: true } });

function steps(download?: MediaDownloader): Step<Data>[] {
  return [
    {
      id: "categories", label: "Services",
      prompt: (data) => ({ text: `Which of your services should this listing show? Reply with numbers separated by commas:\n${numbered(data.categoryChoices.map((choice) => choice.name))}` }),
      answer: (body, data) => { const picks = pickNumbers(body, data.categoryChoices.length, 10); return picks ? { data: { ...data, categoryIds: picks.map((pick) => data.categoryChoices[pick].id), categoryNames: picks.map((pick) => data.categoryChoices[pick].name) } } : { error: "Please reply with numbers from the list." }; },
      summary: (data) => `Services: ${data.categoryNames?.join(", ") ?? "-"}`,
    },
    {
      id: "region", label: "Region",
      prompt: () => ({ text: regionPrompt("do you work in") }),
      answer: (body, data) => { const value = region(body); return value ? { data: { ...data, region: value } } : { error: "Please reply with a region number or name." }; },
      summary: (data) => `Coverage: ${(data.areas ?? []).join(", ")}${data.region ? ` (${data.region})` : ""}`,
    },
    {
      id: "areas", label: "Towns and areas",
      prompt: (data) => ({ text: `Which towns or areas in ${data.region} do you cover? Send them separated by commas, for example: Accra, Tema, Kasoa.` }),
      answer: (body, data) => { const areas = body.split(",").map((area) => text(area, 2, 120)).filter((area): area is string => Boolean(area)); return areas.length && areas.length <= 20 ? { data: { ...data, areas: [...new Set(areas)] } } : { error: "Please send 1 to 20 areas separated by commas." }; },
      summary: () => null,
    },
    {
      id: "description", label: "Description",
      prompt: () => ({ text: "Describe the service clients get: what's included, your experience and how quickly you respond. At least 20 characters." }),
      answer: (body, data) => { const value = paragraph(body, 20, 5000); return value ? { data: { ...data, description: value } } : { error: "Please send at least 20 characters." }; },
      summary: (data) => data.description ? `Description: ${data.description.slice(0, 160)}${data.description.length > 160 ? "…" : ""}` : null,
    },
    {
      id: "pricing", label: "Pricing",
      prompt: () => ({ text: `How do you price this service? Reply with a number:\n${numbered(PRICING.map((item) => item.label))}` }),
      answer: (body, data) => { const pick = pickNumbers(body, PRICING.length, 1); if (!pick) return { error: "Please reply 1, 2 or 3." }; const pricingModel = PRICING[pick[0]].value; return { data: { ...data, pricingModel, priceMinor: pricingModel === "QUOTE" ? null : data.priceMinor } }; },
      summary: (data) => `Pricing: ${data.pricingModel === "QUOTE" ? "quote on request" : `${data.pricingModel === "STARTING_FROM" ? "from " : ""}${data.priceMinor ? formatMinor(data.priceMinor) : "-"}`}`,
    },
    {
      id: "price", label: "Price", when: (data) => data.pricingModel !== "QUOTE",
      prompt: (data) => ({ text: data.pricingModel === "STARTING_FROM" ? "What is your starting price in GHS? For example: 150." : "What is the price in GHS? For example: 300." }),
      answer: (body, data) => { const value = amountMinor(body); return value ? { data: { ...data, priceMinor: value } } : { error: "Please send the amount as a number, for example 150." }; },
      summary: () => null,
    },
    {
      id: "availability", label: "Availability",
      prompt: () => ({ text: `Are you taking jobs? Reply with a number:\n${numbered(AVAILABILITY.map((item) => item.label))}`, interactive: buttons("Are you taking jobs?", AVAILABILITY.map((item, index) => ({ id: String(index + 1), title: item.label.slice(0, 20) }))) }),
      answer: (body, data) => { const pick = pickNumbers(body, AVAILABILITY.length, 1); return pick ? { data: { ...data, availability: AVAILABILITY[pick[0]].value } } : { error: "Please reply 1, 2 or 3." }; },
      summary: (data) => `Availability: ${AVAILABILITY.find((item) => item.value === data.availability)?.label ?? "-"}`,
    },
    {
      id: "portfolio", label: "Portfolio images",
      prompt: async (data) => { const count = (await portfolio(data.providerId)).length; return { text: count ? `${count} of ${MAX_PROVIDER_PORTFOLIO_IMAGES} portfolio images. Send more, or reply done. Reply remove 2 to delete image 2.` : `Send photos of your work (up to ${MAX_PROVIDER_PORTFOLIO_IMAGES}, separate from your logo), or reply done to skip.` }; },
      media: async (mediaId, data, input) => {
        const outcome = await addPortfolioImage({ userId: input.userId, providerId: data.providerId, mediaId }, download);
        if (outcome.status === "added") return { data, reply: `Image ${outcome.count} of ${MAX_PROVIDER_PORTFOLIO_IMAGES} added.${outcome.count >= MAX_PROVIDER_PORTFOLIO_IMAGES ? " That's the maximum; reply done, or remove one to add another." : ""}` };
        if (outcome.status === "duplicate") return { data, reply: `That image is already added (${outcome.count} of ${MAX_PROVIDER_PORTFOLIO_IMAGES}).` };
        if (outcome.status === "limit") return { data, reply: `You already have ${MAX_PROVIDER_PORTFOLIO_IMAGES} portfolio images, so that one wasn't added. Reply remove 2 (for example) to make room.` };
        return { data, reply: `That image wasn't added: ${"message" in outcome ? outcome.message : ""} You can send it again.` };
      },
      answer: async (body, data, input) => {
        const said = command(body);
        if (/^(done|next|skip|finished)$/.test(said)) return { data: { ...data, _photosDone: true } };
        const remove = said.match(/^(?:remove|delete) (\d{1,2})$/);
        if (remove) {
          const image = (await portfolio(data.providerId))[Number(remove[1]) - 1];
          if (!image) return { error: `There is no image ${remove[1]}.` };
          await removeProviderPortfolioImage(input.userId, data.providerId, image.id);
          return { data, stay: `Image ${remove[1]} removed.` };
        }
        return { error: "Send an image, or reply done or remove 2." };
      },
      summary: () => null,
    },
  ];
}

export function serviceListingFlow(download?: MediaDownloader): GuidedFlow<Data> {
  return {
    what: "service listing",
    steps: steps(download),
    read: (raw) => dataSchema.parse(raw),
    reviewNote: async (data) => {
      const provider = await db.serviceProvider.findUnique({ where: { id: data.providerId }, select: { verificationStatus: true, suspendedAt: true } });
      const images = (await portfolio(data.providerId)).length;
      const live = provider?.verificationStatus === "VERIFIED" && !provider.suspendedAt;
      return `Portfolio: ${images} of ${MAX_PROVIDER_PORTFOLIO_IMAGES} images.\n${live ? "On confirm, your listing is published on the NesAfric marketplace." : `Your provider profile is ${statusLabel(provider?.verificationStatus ?? "UNVERIFIED")}, so on confirm this is saved and goes live once NesAfric approves you.`}`;
    },
    submit: (draft, input, revision) => submitServiceListing(draft, input, revision),
  };
}

export async function startServiceListing(input: FlowInput): Promise<FlowResult> {
  const provider = await db.serviceProvider.findFirst({ where: { OR: [{ individualUserId: input.userId }, { administratorUserId: input.userId }] }, select: { id: true, displayName: true, categories: { where: { category: { active: true } }, select: { category: { select: { id: true, name: true } } } } } });
  if (!provider) return { reply: "To list your services, register as a service provider first: reply register services.", exit: true };
  const categoryChoices = provider.categories.map(({ category }) => category).slice(0, 30);
  if (!categoryChoices.length) return { reply: `Add your service categories on the website first: ${absoluteUrl(`/providers/${provider.id}`)}`, exit: true };
  const { draft, created } = await startFlowDraft({ address: input.address, userId: input.userId, kind: "SERVICE_LISTING", step: "categories", data: { providerId: provider.id, providerName: provider.displayName, categoryChoices }, messageId: input.messageId, targets: { serviceProviderId: provider.id } });
  const prompt = await promptFor(serviceListingFlow(), draft);
  return { ...prompt, reply: `${created ? `Let's set up the service listing for ${provider.displayName}. Reply help at any time.` : "Continuing your service listing."}\n\n${prompt.reply}` };
}

export async function continueServiceListing(draft: FlowDraft, input: FlowInput, download?: MediaDownloader) {
  return advanceGuided(serviceListingFlow(download), draft, input);
}

/** Saves the profile; it is listed publicly only if the provider is approved and not suspended now. */
async function submitServiceListing(draft: FlowDraft, input: FlowInput, revision: number): Promise<FlowResult> {
  const data = dataSchema.parse(draft.data);
  if (!await claimFlowDraftForSubmission(draft.id, input.userId, "review", revision, input.messageId)) {
    const latest = await getFlowDraft(draft.id, input.userId);
    if (latest?.status === "SUBMITTED") return { reply: "This service listing was already saved.", exit: true };
    if (latest?.status === "OPEN") {
      const prompt = await promptFor(serviceListingFlow(), latest);
      return { ...prompt, reply: `Your listing changed after you reviewed it, so nothing was saved. Please check it again.\n\n${prompt.reply}` };
    }
    return { reply: "This draft is no longer open. Reply menu to start again.", exit: true };
  }
  try {
    const provider = await ownsProvider(input.userId, data.providerId);
    if (!provider) throw new AppError("FORBIDDEN", 403, "You no longer manage this provider profile.");
    const live = provider.verificationStatus === "VERIFIED" && !provider.suspendedAt;
    // Accepting work needs Super Admin approval (platform rule); availability can be set earlier.
    await updateServiceProvider(input.userId, data.providerId, { availabilityStatus: data.availability, ...(live ? { acceptingWork: data.availability !== "UNAVAILABLE" } : {}) });
    await updateMarketplaceProfile(input.userId, data.providerId, {
      publicDescription: data.description,
      pricingModel: data.pricingModel,
      startingRateMinor: data.pricingModel === "QUOTE" ? null : data.priceMinor,
      currencyCode: data.pricingModel === "QUOTE" ? null : "GHS",
      categoryIds: data.categoryIds,
      serviceAreas: (data.areas ?? []).map((area) => ({ countryCode: "GH", region: data.region, city: area, label: area })),
      listed: live,
    });
    await finishFlowDraft(draft.id, { status: "SUBMITTED", step: "submitted" });
    return { reply: live ? `Your service listing is published. View it: ${absoluteUrl(`/marketplace/${data.providerId}`)}` : `Your service listing is saved. It goes live once NesAfric approves ${data.providerName} (current status: ${statusLabel(provider.verificationStatus)}).`, exit: true };
  } catch (error) {
    await finishFlowDraft(draft.id, { status: "OPEN", step: "review" });
    if (error instanceof AppError && error.status < 500) return { reply: `${error.message} Your answers are saved; reply confirm to try again or edit to change them.`, draftId: draft.id };
    throw error;
  }
}
