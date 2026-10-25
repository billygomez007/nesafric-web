import { absoluteUrl } from "@/platform/brand";
import type { AssistantState } from "../schemas";
import { buttons, command, numbered, type FlowInput, type FlowResult } from "./common";
import { getFlowDraft, listOpenFlowDrafts, type FlowDraft } from "./drafts";
import { promptFor } from "./guided";
import { continueListing, listingFlow, startListing } from "./listing";
import type { MediaDownloader } from "./media";
import { applicationsSummary, continueRegistration, registrationFlow, startRegistration } from "./registration";
import { continueServiceListing, serviceListingFlow, startServiceListing } from "./service-listing";

export type BusinessContext = {
  address: string;
  messageId: string;
  body: string;
  kind: string;
  media?: { id: string; mimeType?: string };
  /** The verified linked account, or null. A phone number alone never grants access. */
  linked: { user: { id: string; displayName: string } } | null;
  state: AssistantState;
  reset: () => AssistantState;
  download?: MediaDownloader;
};

export type BusinessResult = { state: AssistantState; reply: string; interactive?: FlowResult["interactive"] };

/** Exact commands (and menu numbers) that start a business flow. Free text never does. */
const STARTS: Array<[RegExp, "AGENCY" | "AGENT" | "PROVIDER" | "LISTING" | "SERVICE_LISTING" | "STATUS" | "CHOOSE_AGENT_OR_LANDLORD"]> = [
  [/^(3|register agency|register a real estate business|register business|register my agency|real estate business)$/, "AGENCY"],
  [/^(register agent|register as an agent|agent registration)$/, "AGENT"],
  [/^(4|agent or landlord|register as an agent or landlord)$/, "CHOOSE_AGENT_OR_LANDLORD"],
  [/^(6|register services|register service provider|register as a service provider|register a service business|service business)$/, "PROVIDER"],
  [/^(5|list a property|list property|list my property|new listing|add a listing)$/, "LISTING"],
  [/^(list my services|list services|service listing|publish my services)$/, "SERVICE_LISTING"],
  [/^(my applications|application status|my listings|business status)$/, "STATUS"],
];

const kindLabel = (draft: FlowDraft) => draft.kind === "BUSINESS_APPLICATION" ? "business registration" : draft.kind === "PROPERTY_LISTING" ? "property listing" : "service listing";

function draftPrompt(draft: FlowDraft) {
  return draft.kind === "BUSINESS_APPLICATION" ? promptFor(registrationFlow(), draft) : draft.kind === "PROPERTY_LISTING" ? promptFor(listingFlow(), draft) : promptFor(serviceListingFlow(), draft);
}

async function continueDraft(draft: FlowDraft, input: FlowInput, download?: MediaDownloader) {
  return draft.kind === "BUSINESS_APPLICATION" ? continueRegistration(draft, input, download)
    : draft.kind === "PROPERTY_LISTING" ? continueListing(draft, input, download)
      : continueServiceListing(draft, input, download);
}

const MEDIA_STEPS = new Set(["photos", "portfolio", "logo", "certificate", "id_front", "id_back"]);

/**
 * Business registration and listing on the official number. Returns null when the message is
 * not for these flows, so the rest of the assistant handles it.
 */
export async function advanceBusiness(context: BusinessContext): Promise<BusinessResult | null> {
  const said = context.kind === "text" ? command(context.body) : "";
  const { state, reset } = context;
  const toState = (result: FlowResult): BusinessResult => ({
    state: result.exit || !result.draftId ? reset() : { ...reset(), workflow: "business", business: { draftId: result.draftId } },
    reply: result.reply,
    interactive: result.interactive,
  });
  const needLink = (): BusinessResult => ({ state: reset(), reply: `To register a business or list on NesAfric here, first connect this WhatsApp number to your NesAfric account: reply link.\nNo account yet? Create one at ${absoluteUrl("/register")}, then reply link.` });

  if (state.workflow === "business" && state.business?.draftId) {
    if (!context.linked) return needLink();
    const draft = await getFlowDraft(state.business.draftId, context.linked.user.id);
    if (!draft || draft.status !== "OPEN") return { state: reset(), reply: "That draft is no longer open. Reply menu to see what I can do." };
    if (said === "menu") return { state: reset(), reply: `Your ${kindLabel(draft)} is saved. Reply resume to continue it.\n\nReply menu again to see the main menu.` };
    return toState(await continueDraft(draft, flowInput(context), context.download));
  }

  const start = STARTS.find(([pattern]) => pattern.test(said))?.[1];
  if (start === "CHOOSE_AGENT_OR_LANDLORD") {
    const reply = "Are you registering as a property agent or as a landlord?\nReply register agent, or register landlord to set up your own properties.";
    return { state: reset(), reply, interactive: buttons(reply, [{ id: "register agent", title: "Property agent" }, { id: "register landlord", title: "Landlord" }]) };
  }
  if (start) {
    if (!context.linked) return needLink();
    const input = flowInput(context);
    if (start === "STATUS") return { state: reset(), reply: await applicationsSummary(context.linked.user.id, context.address) };
    if (start === "LISTING") return toState(await startListing(input));
    if (start === "SERVICE_LISTING") return toState(await startServiceListing(input));
    return toState(await startRegistration(input, start));
  }

  if (!context.linked) return null;
  const drafts = await listOpenFlowDrafts(context.address, context.linked.user.id);
  if (!drafts.length) return null;

  // "resume" continues the most recent draft, or asks which when there are several.
  if (said === "resume" || said === "drafts") {
    if (drafts.length === 1) { const prompt = await draftPrompt(drafts[0]); return toState({ ...prompt, reply: `Continuing your ${kindLabel(drafts[0])}.\n\n${prompt.reply}` }); }
    return { state: reset(), reply: `You have ${drafts.length} drafts. Reply resume 1, resume 2…:\n${numbered(drafts.map(kindLabel))}` };
  }
  const resume = said.match(/^resume (\d)$/);
  if (resume) {
    const draft = drafts[Number(resume[1]) - 1];
    if (!draft) return { state: reset(), reply: `There is no draft ${resume[1]}. Reply drafts to see them.` };
    const prompt = await draftPrompt(draft);
    return toState({ ...prompt, reply: `Continuing your ${kindLabel(draft)}.\n\n${prompt.reply}` });
  }

  // An image while no draft is active is never guessed onto one: ask which draft it is for.
  if (context.media && state.workflow === "idle") {
    const waiting = drafts.filter((draft) => MEDIA_STEPS.has(draft.step));
    if (waiting.length) return { state: reset(), reply: `I didn't save that image because it isn't clear which draft it belongs to. Reply ${waiting.length === 1 ? "resume" : "drafts"} to choose the draft, then send the image again.` };
  }
  return null;
}

const flowInput = (context: BusinessContext): FlowInput => ({ address: context.address, userId: context.linked!.user.id, messageId: context.messageId, body: context.body, kind: context.kind, media: context.media });
