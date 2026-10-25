import { absoluteUrl } from "@/platform/brand";
import { AppError } from "@/platform/errors";
import { replyButtons, type WhatsAppInteractive } from "@/modules/conversations/channels/whatsapp-interactive";
import { assistantStateSchema, initialState, type AssistantState, type Interpretation } from "./schemas";
import { interpretMessage } from "./interpret";
import { marketplaceTools, type MarketplaceTools } from "./tools";
import { formatViewingTime, parseViewingTime } from "./viewing-time";

export const MAIN_MENU = `Welcome to NesAfric! 🏡\n1. Find a property\n2. Find a service provider\n3. Register a real estate business\n4. Register as an agent or landlord\n5. List a property\n6. Register a service business\n7. Check my request\n8. Talk to support\n\nTell me what you need, or choose a number. Business registration and listing currently continue securely on the website. Use menu, resume or cancel at any time.`;

const WEBSITE_ONLY = " Business registration and listing currently continue securely on the website.";
/** The official number's menu: registration and listing happen in the conversation there. */
export const OFFICIAL_MAIN_MENU = MAIN_MENU.replace(WEBSITE_ONLY, "");

/** Replaces the numbered lines of MAIN_MENU in an interactive list body: the rows carry them. */
const MENU_INTRO = "Welcome to NesAfric! 🏡\nTap \"Choose an option\" below, or tell me what you need. Business registration and listing currently continue securely on the website. Use menu, resume or cancel at any time.";
const MENU_ROWS = [
  { id: "1", title: "Find a property" },
  { id: "2", title: "Find a service provider" },
  { id: "3", title: "Register agency", description: "Register a real estate business or agency" },
  { id: "4", title: "Register agent/landlord", description: "Register as an agent or landlord" },
  { id: "5", title: "List a property" },
  { id: "6", title: "Register as provider", description: "Register a service business" },
  { id: "7", title: "Check my request" },
  { id: "8", title: "Talk to support" },
];
const OFFICIAL_MENU_ROWS = [
  { id: "link", title: "Link my account", description: "Connect this WhatsApp number to your NesAfric account" },
  { id: "account", title: "My account", description: "Your properties, tenancies and jobs" },
];

/**
 * The main menu as a WhatsApp list. Each row id is the number or command the assistant already
 * handles, so a tap and a typed reply take the same path. `reply`, which contains MAIN_MENU, stays
 * the stored plain-text fallback. Undefined when the list body would exceed WhatsApp's limits.
 */
export function mainMenuList(reply: string, official = false): WhatsAppInteractive | undefined {
  const menu = official && reply.includes(OFFICIAL_MAIN_MENU) ? OFFICIAL_MAIN_MENU : MAIN_MENU;
  if (!reply.includes(menu)) return undefined;
  const rows = official ? [...MENU_ROWS, ...OFFICIAL_MENU_ROWS] : MENU_ROWS;
  const intro = menu === OFFICIAL_MAIN_MENU ? MENU_INTRO.replace(WEBSITE_ONLY, "") : MENU_INTRO;
  const list = { type: "list" as const, body: reply.replace(menu, intro), button: "Choose an option", sections: [{ title: "How can we help?", rows }] };
  return list.body.length <= 1024 ? list : undefined;
}

const confirmButtons = (text: string) => replyButtons(text, [{ id: "confirm", title: "Confirm" }, { id: "cancel", title: "Cancel" }]);
const resumeButtons = (text: string) => replyButtons(text, [{ id: "resume", title: "Resume" }, { id: "cancel", title: "Cancel" }]);

type Result = { state: AssistantState; reply: string; handoff?: boolean; /** List or reply buttons sent with `reply` as their fallback text. */ interactive?: WhatsAppInteractive };
export type EngineInput = { state: unknown; body: string; kind: string; phone: string; conversationId: string; messageId: string; defaultCountry: string; defaultCurrency: string };
type Dependencies = { tools: MarketplaceTools; interpret: typeof interpretMessage };

function promptFor(state: AssistantState) {
  if (state.step === "name") return "What name should the agent use for this request?";
  if (state.step === "message") return "What would you like to ask about this property?";
  if (state.step === "time") return "When would you like to view it? Send a date and time in Ghana time, for example tomorrow 2pm, saturday 10:30am or 20/12 14:00. This requests a one-hour slot; the agent must confirm it.";
  if (state.step === "confirm") return "Reply confirm to submit this request, or cancel to discard it.";
  if (state.workflow === "property_search") return !state.property.listingType ? "Are you looking to rent or buy?" : !state.property.location ? "Which area should I search?" : "Send search to see matching properties, or tell me which filters to change.";
  if (state.workflow === "service_search") return !state.service.q ? "What service do you need?" : !state.service.city ? "Which area do you need the service in?" : "Send search to see providers, or tell me what to change.";
  return MAIN_MENU;
}

export async function advanceConversation(input: EngineInput, dependencies: Dependencies = { tools: marketplaceTools, interpret: interpretMessage }): Promise<Result> {
  const result = await advance(input, dependencies);
  return result.interactive || !result.reply.includes(MAIN_MENU) ? result : { ...result, interactive: mainMenuList(result.reply) };
}

async function advance(input: EngineInput, dependencies: Dependencies): Promise<Result> {
  const parsed = assistantStateSchema.safeParse(input.state ?? {});
  const state = parsed.success ? structuredClone(parsed.data) : initialState();
  const body = input.body.trim();
  const command = body.toLowerCase();
  const reply = (text: string): Result => ({ state, reply: text });
  if (command === "cancel") return { state: { ...initialState(), lastRequest: state.lastRequest }, reply: "The current conversation workflow is cancelled. Submitted requests are unchanged.\n\n" + MAIN_MENU };
  if (["menu", "help", "hi", "hello", "start"].includes(command)) {
    state.paused = state.workflow !== "idle";
    return reply(MAIN_MENU + (state.paused ? "\n\nYour previous workflow is saved. Reply resume to continue or cancel before starting another." : ""));
  }
  if (command === "resume") { state.paused = false; return state.step === "confirm" ? { ...reply(promptFor(state)), interactive: confirmButtons(promptFor(state)) } : reply(promptFor(state)); }
  if (/^(support|human|8)$/.test(command)) return { ...reply("Your conversation has been added to the support queue. A team member will need to respond; no response time is guaranteed. Reply menu to go back to the assistant."), handoff: true };
  if (state.paused) { const text = "Your unfinished workflow is saved. Reply resume to continue, or cancel to start another."; return { ...reply(text), interactive: resumeButtons(text) }; }
  if (input.kind !== "text") return reply("I received your message, but WhatsApp media uploads and map locations are not supported by this assistant yet. No file has been attached to a listing. Use the secure website to upload files, or reply support for help.");

  // Only exact, user-authored confirmation can write a business record. No model call here.
  if (state.workflow === "inquiry" || state.workflow === "viewing") {
    if (state.step === "name") {
      if (body.length < 2 || body.length > 160) return reply("Please send a name between 2 and 160 characters.");
      state.name = body; state.step = state.workflow === "viewing" ? "time" : "message";
      return reply(promptFor(state));
    }
    if (state.step === "message") {
      if (body.length > 5000) return reply("Please shorten your inquiry to 5,000 characters.");
      state.message = body; state.step = "confirm";
    } else if (state.step === "time") {
      const startsAt = parseViewingTime(body);
      if (!startsAt) return reply("I could not read that as a future date and time within the next year.\n" + promptFor(state));
      state.startsAt = startsAt.toISOString(); state.step = "confirm";
    } else if (state.step === "confirm") {
      if (command !== "confirm") { const text = "Nothing has been submitted. Reply confirm to submit, or cancel to start again."; return { ...reply(text), interactive: confirmButtons(text) }; }
      try {
        const request = await dependencies.tools.submitCustomerRequest({ state, phone: input.phone, messageId: input.messageId, conversationId: input.conversationId });
        return { state: { ...initialState(), lastRequest: request }, reply: request.viewingId ? `Viewing request saved. Reference: ${request.viewingId}. The appointment is not confirmed. Reply status to check it.` : `Inquiry saved. Reference: ${request.leadId}. Reply status to check it.` };
      } catch (error) {
        if (error instanceof AppError && error.status < 500) return reply("This request cannot currently be submitted. The property may no longer be available or the viewing time may have passed. Your details are saved; reply cancel to search again or support for help.");
        // The worker rolls back state/reply and retries the same idempotent domain action.
        throw error;
      }
    }
    const details = await dependencies.tools.propertyDetails(state.selectedListingId!);
    const review = `Review your ${state.workflow === "viewing" ? "viewing request" : "inquiry"}:\nProperty: ${details.title}\nName: ${state.name}\nPhone shared with the listing team: +${input.phone.replace(/^\+/, "")}\n${state.startsAt ? `Preferred one-hour slot starts: ${formatViewingTime(state.startsAt)}` : `Question: ${state.message}`}\n\nReply confirm to submit and share these details, or cancel.`;
    // A long question cannot fit a button message; it then goes out as plain text.
    return { ...reply(review), interactive: confirmButtons(review) };
  }

  const selection = command.match(/^(details|inquire|view)\s+([1-3])$/);
  if (selection && state.workflow === "property_search") {
    const id = state.results[Number(selection[2]) - 1];
    if (!id) return reply("Choose a property number from the most recent results.");
    try {
      const details = await dependencies.tools.propertyDetails(id);
      if (selection[1] === "details" || selection[1] === "") return reply(`${details.title}\n${details.description}\n${details.url}\n\nOnly the published details above are known. Reply inquire ${selection[2]} to ask the listing team, or view ${selection[2]} to request a viewing.`);
      if (!details.enquiryEnabled) return reply(`This property does not accept this request here. See its available actions: ${details.url}`);
      state.selectedListingId = id; state.workflow = selection[1] === "view" ? "viewing" : "inquiry"; state.step = "name";
      return reply(promptFor(state));
    } catch (error) {
      if (error instanceof AppError && error.status === 404) return reply("This property is no longer available in the public marketplace. Send search for current results.");
      throw error;
    }
  }
  if (selection && state.workflow === "service_search") return reply(!state.results[Number(selection[2]) - 1] ? "Choose a provider number from the most recent results." : `Open provider ${selection[2]}'s profile link above to contact them or request a quote securely. Reply more for other providers, or cancel to start another search.`);
  if (command === "more" && (state.workflow === "property_search" || state.workflow === "service_search")) {
    if (!state.hasMore) return reply("There are no more results for these filters. Change the area or budget, or cancel to start another search.");
    state.page += 1;
  } else {
    const interpretation: Interpretation = await dependencies.interpret(body, state);
    if (interpretation.intent === "support") return { ...reply("Your conversation has been added to the support queue. Reply menu to go back to the assistant."), handoff: true };
    if (interpretation.intent === "registration" || interpretation.intent === "listing") return reply(`Continue securely in your NesAfric account: ${absoluteUrl(interpretation.intent === "registration" ? "/onboarding" : "/pro")}\nWhatsApp business onboarding and listing editing are not enabled yet. Your WhatsApp number alone cannot grant access to a business or its listings. Reply support if you need help.`);
    if (interpretation.intent === "status") return reply(state.lastRequest ? await dependencies.tools.customerRequestStatus(state.lastRequest, input.phone) : `There is no submitted customer request in this conversation. For your business applications and listings, sign in: ${absoluteUrl("/pro")}`);
    if (interpretation.intent === "unknown") return reply("Would you like to find a property, find a service provider, or talk to support? Please choose one task first.");
    if (state.workflow !== "idle" && state.workflow !== interpretation.intent) { state.paused = true; const text = "You have a saved search. Reply resume to continue it, or cancel and send your new request again."; return { ...reply(text), interactive: resumeButtons(text) }; }
    state.workflow = interpretation.intent; state.page = 1;
    if (interpretation.intent === "property_search") state.property = { country: input.defaultCountry, currencyCode: input.defaultCurrency, ...state.property, ...interpretation.property };
    else state.service = { country: input.defaultCountry, ...state.service, ...interpretation.service };
  }
  if (state.workflow === "property_search") {
    if (!state.property.listingType || !state.property.location) return reply(promptFor(state));
    if (state.property.listingType === "RENT" && state.property.maxPriceMinor && !state.property.frequency) return reply("Is that rental budget per month, per year, per quarter or per night?");
    const found = await dependencies.tools.searchProperties(state.property, state.page);
    state.results = found.ids; state.hasMore = found.hasMore;
    const filters = `Filters: ${state.property.listingType}, ${state.property.location}${state.property.category ? `, ${state.property.category}` : ""}${state.property.maxPriceMinor ? `, maximum ${state.property.currencyCode} ${Number(state.property.maxPriceMinor) / 100}${state.property.frequency ? ` ${state.property.frequency}` : ""}` : ""}${state.property.bedroomsMin !== undefined ? `, ${state.property.bedroomsMin} bedrooms` : ""}.`;
    return reply(found.ids.length ? `${filters}\n\n${found.cards.join("\n\n")}\n\nReply details 1, inquire 1 or view 1 for a result.${found.hasMore ? " Reply more for the next page." : ""}` : `${filters}\nNo published, available properties match. You can change the area or budget. I have not relaxed your filters.`);
  }
  if (!state.service.q || !state.service.city) return reply(promptFor(state));
  const found = await dependencies.tools.searchServices(state.service, state.page);
  state.results = found.ids; state.hasMore = found.hasMore;
  return reply(found.ids.length ? `${found.cards.join("\n\n")}\n\nOpen a provider profile to contact them or request a quote securely.${found.hasMore ? " Reply more for the next page." : ""}` : "No verified providers match this service and area. Try another area or service; I have not broadened your search.");
}
