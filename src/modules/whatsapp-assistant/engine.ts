import { absoluteUrl } from "@/platform/brand";
import { AppError } from "@/platform/errors";
import { replyButtons, type WhatsAppInteractive } from "@/modules/conversations/channels/whatsapp-interactive";
import { assistantStateSchema, initialState, type AssistantState, type Interpretation } from "./schemas";
import { interpretMessage } from "./interpret";
import { marketplaceTools, type MarketplaceTools } from "./tools";
import { formatViewingTime, parseViewingTime } from "./viewing-time";
import { propertyCard, propertyDetailsMessage, resultsNavigation, type PropertyMessage } from "./property-cards";
import { dayPicker, readPickerAnswer, timePicker } from "./viewing-picker";
import { locationLabel } from "./property-cards";
import { viewingReference } from "./viewings";
import { answerSearchStep, describeFilters, GUIDED_START, nextSearchStep, searchStepPrompt, type SearchStep } from "./search-steps";

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

type Result = { state: AssistantState; reply: string; handoff?: boolean; /** List or reply buttons sent with `reply` as their fallback text. */ interactive?: WhatsAppInteractive; /** Messages sent after the reply, in order (property cards). */ extras?: PropertyMessage[] };
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
  // The paging and no-results buttons (the official number answers these in its router first).
  if (command === "new search") return { state: { ...initialState(), lastRequest: state.lastRequest }, reply: MAIN_MENU };
  if (command === "change filters" && state.workflow === "property_search") { state.paused = false; return reply("Tell me what to change, for example: in East Legon, under 5000 a month, 2 bedrooms, or apartment. I'll search again with the new filters."); }
  if (command === "resume" && state.step === "time" && state.workflow === "viewing") { state.paused = false; return { state, ...dayPicker() }; }
  if (command === "resume") { state.paused = false; return state.step === "confirm" ? { ...reply(promptFor(state)), interactive: confirmButtons(promptFor(state)) } : reply(promptFor(state)); }
  if (/^(support|human|8)$/.test(command)) return { ...reply("Your conversation has been added to the support queue. A team member will need to respond; no response time is guaranteed. Reply menu to go back to the assistant."), handoff: true };
  if (state.paused) { const text = "Your unfinished workflow is saved. Reply resume to continue, or cancel to start another."; return { ...reply(text), interactive: resumeButtons(text) }; }
  if (input.kind !== "text") return reply("I received your message, but WhatsApp media uploads and map locations are not supported by this assistant yet. No file has been attached to a listing. Use the secure website to upload files, or reply support for help.");

  // Only exact, user-authored confirmation can write a business record. No model call here.
  if (state.workflow === "inquiry" || state.workflow === "viewing") {
    if (state.step === "name") {
      if (body.length < 2 || body.length > 160) return reply("Please send a name between 2 and 160 characters.");
      state.name = body; state.step = state.workflow === "viewing" ? "time" : "message";
      // The day, then the time, are chosen from WhatsApp lists (typing still works).
      return state.workflow === "viewing" ? { state, ...dayPicker() } : reply(promptFor(state));
    }
    if (state.step === "message") {
      if (body.length > 5000) return reply("Please shorten your inquiry to 5,000 characters.");
      state.message = body; state.step = "confirm";
    } else if (state.step === "time") {
      const picked = readPickerAnswer(body, state.viewingDay);
      const again = (lead: string) => { state.viewingDay = undefined; const days = dayPicker(); return { state, reply: `${lead}\n${days.reply}`, interactive: { ...days.interactive, body: `${lead} ${days.interactive.body}`.slice(0, 1024) } }; };
      if (picked === "unavailable") return again("That day or time is no longer available.");
      if (picked && "other" in picked) return reply(promptFor(state));
      if (picked && "day" in picked) {
        state.viewingDay = picked.day;
        return { state, ...(timePicker(picked.day) ?? again("That day has no times left.")) };
      }
      const startsAt = picked && "startsAt" in picked ? picked.startsAt : parseViewingTime(body);
      if (!startsAt) return again("I could not read that as a future date and time within the next year.");
      state.startsAt = startsAt.toISOString(); state.viewingDay = undefined; state.step = "confirm";
    } else if (state.step === "confirm") {
      if (command !== "confirm") { const text = "Nothing has been submitted. Reply confirm to submit, or cancel to start again."; return { ...reply(text), interactive: confirmButtons(text) }; }
      try {
        const request = await dependencies.tools.submitCustomerRequest({ state, phone: input.phone, messageId: input.messageId, conversationId: input.conversationId });
        if (!request.viewingId) return { state: { ...initialState(), lastRequest: request }, reply: `Inquiry saved. Reference: ${request.leadId}. Reply status to check it.` };
        const listing = await dependencies.tools.propertyDetails(state.selectedListingId!).catch(() => null);
        const [day, time] = formatViewingTime(state.startsAt!).replace(/ GMT$/, "").split(", ");
        const lines = [
          "✅ *Viewing request received*", "",
          listing ? `🏠 ${listing.title}` : null,
          listing?.listing ? `📍 ${locationLabel(listing.listing.location)}` : null,
          `📅 ${day}`, `🕒 ${time} (Ghana time)`, `👤 ${state.name}`, `🔖 Reference: ${viewingReference(request.viewingId)}`, "",
          "*What happens next*",
          "1. We have sent your request to the agent.",
          "2. The agent will confirm this time or suggest another.",
          "3. We will notify you here on WhatsApp as soon as they reply.", "",
          "This viewing is not confirmed yet. Reply status at any time to check it.",
        ].filter((line) => line !== null);
        return { state: { ...initialState(), lastRequest: request }, reply: lines.join("\n") };
      } catch (error) {
        if (error instanceof AppError && error.status < 500) return reply("This request cannot currently be submitted. The property may no longer be available or the viewing time may have passed. Your details are saved; reply cancel to search again or support for help.");
        // The worker rolls back state/reply and retries the same idempotent domain action.
        throw error;
      }
    }
    const details = await dependencies.tools.propertyDetails(state.selectedListingId!);
    const when = state.startsAt ? formatViewingTime(state.startsAt).replace(/ GMT$/, "").split(", ") : null;
    const review = state.startsAt
      ? `*Please check your viewing request*\n\n🏠 ${details.title}\n📅 ${when![0]}\n🕒 ${when![1]} (Ghana time)\n👤 ${state.name}\n📱 +${input.phone.replace(/^\+/, "")} (shared with the agent)\n\nTap Confirm to send it to the agent, or Cancel.`
      : `Review your inquiry:\nProperty: ${details.title}\nName: ${state.name}\nPhone shared with the listing team: +${input.phone.replace(/^\+/, "")}\nQuestion: ${state.message}\n\nReply confirm to submit and share these details, or cancel.`;
    // A long question cannot fit a button message; it then goes out as plain text.
    return { ...reply(review), interactive: confirmButtons(review) };
  }

  // A number picks from the latest results; a card's button carries the listing id itself.
  const selection = command.match(/^(details|inquire|view)\s+([1-3]|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/);
  if (selection && (state.workflow === "property_search" || (selection[2].length > 1 && ["idle", "inquiry", "viewing"].includes(state.workflow)))) {
    const id = selection[2].length > 1 ? selection[2] : state.results[Number(selection[2]) - 1];
    if (!id) return reply("Choose a property number from the most recent results.");
    try {
      const details = await dependencies.tools.propertyDetails(id);
      if (selection[1] === "details" || selection[1] === "") {
        if (details.listing) { const message = propertyDetailsMessage(details.listing); return { state, reply: message.body, interactive: message.interactive }; }
        return reply(`${details.title}\n${details.description}\n${details.url}\n\nOnly the published details above are known. Reply inquire ${selection[2]} to ask the listing team, or view ${selection[2]} to request a viewing.`);
      }
      if (!details.enquiryEnabled) return reply(`This property does not accept this request here. See its available actions: ${details.url}`);
      if (state.workflow !== "property_search" && state.workflow !== "idle") { state.message = undefined; state.startsAt = undefined; }
      state.selectedListingId = id; state.workflow = selection[1] === "view" ? "viewing" : "inquiry"; state.step = "name";
      return reply(promptFor(state));
    } catch (error) {
      if (error instanceof AppError && error.status === 404) return reply("This property is no longer available in the public marketplace. Send search for current results.");
      throw error;
    }
  }
  if (selection && state.workflow === "service_search") return reply(!state.results[Number(selection[2]) - 1] ? "Choose a provider number from the most recent results." : `Open provider ${selection[2]}'s profile link above to contact them or request a quote securely. Reply more for other providers, or cancel to start another search.`);
  // A guided search step answered by a tap or a short reply; anything else is read as free text.
  const asked: SearchStep | undefined = state.workflow === "property_search" && state.guided && !state.paused ? state.searchStep : undefined;
  const answered = asked !== undefined && command !== "more" && answerSearchStep(state, asked, body);
  if (answered) state.page = 1;
  if (command === "more" && (state.workflow === "property_search" || state.workflow === "service_search")) {
    if (!state.hasMore) return reply("There are no more results for these filters. Change the area or budget, or cancel to start another search.");
    state.page += 1;
  } else if (!answered) {
    const interpretation: Interpretation = await dependencies.interpret(body, state);
    // A bare number is never an area; anything else that is not a search answer is asked again.
    if (asked && ((interpretation.intent !== "property_search" && interpretation.intent !== "support") || (asked === "area" && /^\d+$/.test(body)))) return guidedPrompt(state, asked, dependencies, "I didn't catch that. ");
    if (interpretation.intent === "support") return { ...reply("Your conversation has been added to the support queue. Reply menu to go back to the assistant."), handoff: true };
    if (interpretation.intent === "registration" || interpretation.intent === "listing") return reply(`Continue securely in your NesAfric account: ${absoluteUrl(interpretation.intent === "registration" ? "/onboarding" : "/pro")}\nWhatsApp business onboarding and listing editing are not enabled yet. Your WhatsApp number alone cannot grant access to a business or its listings. Reply support if you need help.`);
    if (interpretation.intent === "status") return reply(state.lastRequest ? await dependencies.tools.customerRequestStatus(state.lastRequest, input.phone) : `There is no submitted customer request in this conversation. For your business applications and listings, sign in: ${absoluteUrl("/pro")}`);
    if (interpretation.intent === "unknown") return reply("Would you like to find a property, find a service provider, or talk to support? Please choose one task first.");
    if (state.workflow !== "idle" && state.workflow !== interpretation.intent) { state.paused = true; const text = "You have a saved search. Reply resume to continue it, or cancel and send your new request again."; return { ...reply(text), interactive: resumeButtons(text) }; }
    // Starting from a menu answer (rent, buy, land, office...) asks for the other filters step by step.
    if (state.workflow === "idle" && interpretation.intent === "property_search" && GUIDED_START.test(command)) { state.guided = true; state.searchAnswered = []; state.searchStep = undefined; }
    state.workflow = interpretation.intent; state.page = 1;
    if (interpretation.intent === "property_search") state.property = { country: input.defaultCountry, currencyCode: input.defaultCurrency, ...state.property, ...interpretation.property };
    if (asked && interpretation.intent === "property_search") {
      const set = { type: state.property.category, bedrooms: state.property.bedroomsMin, area: state.property.location, budget: state.property.maxPriceMinor ?? state.property.minPriceMinor }[asked];
      if (set !== undefined) state.searchAnswered = [...new Set([...state.searchAnswered, asked])];
    }
    else state.service = { country: input.defaultCountry, ...state.service, ...interpretation.service };
  }
  if (state.workflow === "property_search") {
    if (!state.property.listingType) return reply(promptFor(state));
    if (state.guided) {
      const step = nextSearchStep(state);
      if (step) return guidedPrompt(state, step, dependencies, asked === step && !answered ? "I didn't catch that. " : "");
      state.searchStep = undefined;
    }
    if (!state.property.location) return reply(promptFor(state));
    if (state.property.listingType === "RENT" && state.property.maxPriceMinor && !state.property.frequency) return reply("Is that rental budget per month, per year, per quarter or per night?");
    const found = await dependencies.tools.searchProperties(state.property, state.page);
    state.results = found.ids; state.hasMore = found.hasMore;
    const filters = describeFilters(state.property);
    if (!found.ids.length) {
      const text = `${filters}\nNo published, available properties match. You can change the area or budget. I have not relaxed your filters.`;
      return { state, reply: text, interactive: replyButtons(text, [{ id: "change filters", title: "Change filters" }, { id: "new search", title: "New search" }]) };
    }
    // Cards with the cover photo when the search returns full listings; the text list otherwise.
    if (found.listings?.length && found.total) {
      const from = (state.page - 1) * 3 + 1;
      const extras = [...found.listings.map((listing, index) => propertyCard(listing, from + index, found.total!)), resultsNavigation({ from, to: from + found.listings.length - 1, total: found.total }, found.hasMore)];
      return { state, reply: `${filters}\nHere ${found.total === 1 ? "is the matching property" : "are matching properties"}:`, extras };
    }
    return reply(`${filters}\n\n${found.cards.join("\n\n")}\n\nReply details 1, inquire 1 or view 1 for a result.${found.hasMore ? " Reply more for the next page." : ""}`);
  }
  if (!state.service.q || !state.service.city) return reply(promptFor(state));
  const found = await dependencies.tools.searchServices(state.service, state.page);
  state.results = found.ids; state.hasMore = found.hasMore;
  return reply(found.ids.length ? `${found.cards.join("\n\n")}\n\nOpen a provider profile to contact them or request a quote securely.${found.hasMore ? " Reply more for the next page." : ""}` : "No verified providers match this service and area. Try another area or service; I have not broadened your search.");
}

async function guidedPrompt(state: AssistantState, step: SearchStep, dependencies: Dependencies, prefix: string): Promise<Result> {
  state.searchStep = step;
  const inventory = step === "type" && state.property.listingType ? await dependencies.tools.propertyTypes?.(state.property.listingType).catch(() => []) ?? [] : [];
  const prompt = searchStepPrompt(state, step, inventory);
  const interactive = prompt.interactive && prefix ? { ...prompt.interactive, body: `${prefix}${prompt.interactive.body}` } : prompt.interactive;
  return { state, reply: `${prefix}${prompt.reply}`, interactive };
}
