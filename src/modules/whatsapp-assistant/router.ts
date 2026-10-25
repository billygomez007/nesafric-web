import { absoluteUrl } from "@/platform/brand";
import { AppError } from "@/platform/errors";
import { maskPhone } from "@/platform/identity/phone";
import { requestOtp, verifyOtp } from "@/modules/identity/otp";
import { advanceConversation, MAIN_MENU, type EngineInput } from "./engine";
import { replyButtons, type WhatsAppInteractive } from "@/modules/conversations/channels/whatsapp-interactive";
import { assistantStateSchema, initialState, type AssistantState } from "./schemas";
import { linkedWhatsAppUser, linkWhatsAppIdentity, unlinkWhatsAppIdentity, whatsappAddress } from "./identity";
import { formatAccountSummary, resolveAccountRoles } from "./account";
import { advanceOnboarding } from "./onboarding/flow";
import { findOpenDraft } from "./onboarding/draft";
import { advanceNetwork, handleProviderMessage } from "./network";
import { advanceReport } from "./maintenance/report";
import { advanceRules, isRuleCommand } from "./rules";
import { advanceJobs } from "./jobs";
import { answerLandlord } from "./landlord";
import { advanceBusiness } from "./business";
import { invitationReply } from "@/modules/whatsapp-templates/invitation-reply";
import { searchAgents } from "./tools";
import { COMMERCIAL_PROMPT, commercialChoices, FIND_PROPERTY_PROMPT, findPropertyChoices, greetingLine, MORE_OPTIONS, OFFICIAL_ALIASES, OFFICIAL_MENU_COMMANDS, rentOrBuyButtons, VIEWING_PROMPT, viewingButtons, welcomeReply } from "./welcome";

export type OfficialInput = EngineInput & { organisationId: string; media?: { id: string; mimeType?: string }; /** Provider message id this message replied to (quick-reply buttons). */ replyTo?: string; /** The sender's WhatsApp profile name, as Meta sent it (untrusted, display only). */ profileName?: string };
export type OfficialResult = { state: AssistantState; reply: string; handoff?: boolean; /** The inbound text was a one-time code and must not stay in the transcript. */ redactInbound?: boolean; replyMetadata?: Record<string, unknown>; /** List or reply buttons sent with `reply` as their fallback text. */ interactive?: WhatsAppInteractive; /** Messages sent after the reply, in order (property cards). */ extras?: Array<{ body: string; interactive?: WhatsAppInteractive }> };

const START_ONBOARDING = /^(register|register landlord|landlord|property manager|add my property|add my properties|onboard|set up my properties)$/;
const MAX_CODE_FAILURES = 5;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}$/;

type Dependencies = {
  engine: typeof advanceConversation;
  requestOtp: typeof requestOtp;
  verifyOtp: typeof verifyOtp;
  linkedUser: typeof linkedWhatsAppUser;
  link: typeof linkWhatsAppIdentity;
  unlink: typeof unlinkWhatsAppIdentity;
  roles: typeof resolveAccountRoles;
  onboarding: typeof advanceOnboarding;
  openDraft: typeof findOpenDraft;
  providerMessage: typeof handleProviderMessage;
  network: typeof advanceNetwork;
  report: typeof advanceReport;
  rules: typeof advanceRules;
  jobs: typeof advanceJobs;
  landlord: typeof answerLandlord;
  business: typeof advanceBusiness;
  invitationReply: typeof invitationReply;
  agents: typeof searchAgents;
  /** The clock for the greeting (tests pass a fixed time). */
  now?: () => Date;
};
const defaults: Dependencies = { engine: advanceConversation, requestOtp, verifyOtp, linkedUser: linkedWhatsAppUser, link: linkWhatsAppIdentity, unlink: unlinkWhatsAppIdentity, roles: resolveAccountRoles, onboarding: advanceOnboarding, openDraft: findOpenDraft, providerMessage: handleProviderMessage, network: advanceNetwork, report: advanceReport, rules: advanceRules, jobs: advanceJobs, landlord: answerLandlord, business: advanceBusiness, invitationReply, agents: searchAgents, now: () => new Date() };

const methodPrompt = (phone: string) => `To connect this number I need to confirm the NesAfric account is yours.\nReply sms to get a 6-digit code by text message at ${maskPhone(whatsappAddress(phone))}, or send the email address on your NesAfric account to get it by email.\nReply cancel to stop.`;

/**
 * The official NesAfric number. Account linking and account views are deterministic commands: no
 * model output decides who someone is or what they can see. Everything else is the marketplace
 * assistant.
 */
export async function advanceOfficialConversation(input: OfficialInput, dependencies: Dependencies = defaults): Promise<OfficialResult> {
  const parsed = assistantStateSchema.safeParse(input.state ?? {});
  let state = parsed.success ? structuredClone(parsed.data) : initialState();
  let command = input.body.trim().toLowerCase();
  const reset = (): AssistantState => ({ ...initialState(), lastRequest: state.lastRequest });
  // A linked account's name is preferred to the WhatsApp profile name; neither is ever required.
  const greeting = async () => greetingLine(dependencies.now?.() ?? new Date(), (await dependencies.linkedUser(input.phone))?.user.displayName ?? input.profileName);

  if (state.workflow === "link") return continueLink(input, state, reset, dependencies);

  // The welcome menu. A bare number is a menu choice wherever a search is open (results are picked
  // with "details 2"); an option's words or list tap count when nothing else is under way.
  const searching = ["idle", "property_search", "service_search", "agent_search"].includes(state.workflow);
  if (input.kind === "text" && (searching || ["inquiry", "viewing"].includes(state.workflow))) {
    // During a guided search step a number is its answer (2 bedrooms), not a menu choice.
    const answering = state.workflow === "property_search" && state.guided && Boolean(state.searchStep) && !state.paused;
    const pick = searching ? (answering ? undefined : OFFICIAL_MENU_COMMANDS[command]) ?? (state.workflow === "idle" || state.paused ? OFFICIAL_ALIASES[command] : undefined) : undefined;
    const navigation = !pick && ["menu", "cancel"].includes(OFFICIAL_ALIASES[command] ?? "") ? OFFICIAL_ALIASES[command] : undefined;
    if (pick && !["menu", "cancel"].includes(pick)) state = reset();
    const target = pick ?? navigation;
    if (target) {
      command = target;
      input = { ...input, body: target, state };
    }
    if (pick === "more options") return { state, reply: MORE_OPTIONS };
    if (pick === "find a property") return { state, reply: FIND_PROPERTY_PROMPT, interactive: findPropertyChoices() };
    if (command === "new search" && (state.workflow === "property_search" || state.workflow === "idle")) return { state: reset(), reply: FIND_PROPERTY_PROMPT, interactive: findPropertyChoices() };
    if (command === "change filters" && state.workflow === "property_search") return { state: { ...state, paused: false }, reply: CHANGE_FILTERS_PROMPT };
    if (pick === "commercial") return { state, reply: COMMERCIAL_PROMPT, interactive: commercialChoices() };
    if (pick === "book a viewing") return { state, reply: VIEWING_PROMPT, interactive: viewingButtons() };
    if (pick === "find an agent") return { state: { ...state, workflow: "agent_search", agentArea: undefined, page: 1 }, reply: AGENT_AREA_PROMPT };
    if (pick === "property services") input = { ...input, body: "service provider" };
    if (state.workflow === "agent_search" && command === "resume") return { state: { ...state, paused: false }, reply: AGENT_AREA_PROMPT };
    if (state.workflow === "agent_search" && !state.paused && !target && !["menu", "cancel", "support", "resume"].includes(command)) return findAgents(input.body.trim(), state, reset, dependencies);
  }

  // Onboarding keeps its progress in its own draft, so it survives conversation resets.
  const startsOnboarding = input.kind === "text" && (START_ONBOARDING.test(command) || (command === "resume" && state.workflow === "idle" && Boolean(await dependencies.openDraft(whatsappAddress(input.phone)))));
  if (state.workflow === "onboarding" || startsOnboarding) {
    const result = await dependencies.onboarding({ phone: input.phone, messageId: input.messageId, body: input.body, kind: input.kind, organisationId: input.organisationId, defaultCountry: input.defaultCountry, defaultCurrency: input.defaultCurrency });
    return { state: result.exit ? reset() : { ...reset(), workflow: "onboarding" }, reply: result.reply, redactInbound: result.redactInbound };
  }

  // Business registration and listings: exact commands, menu numbers, or the active draft. Also
  // reachable from a search, where bare numbers are menu choices (results use "details 2").
  if (["idle", "business", "property_search", "service_search"].includes(state.workflow)) {
    const business = await dependencies.business({ address: whatsappAddress(input.phone), messageId: input.messageId, body: input.body, kind: input.kind, media: input.media, linked: await dependencies.linkedUser(input.phone), state, reset });
    if (business) return business;
  }

  // Work orders: provider answers and progress, landlord quote decisions, tenant confirmation.
  if (state.workflow === "idle" || state.workflow === "job") {
    const job = await dependencies.jobs({ body: input.body, kind: input.kind, messageId: input.messageId, media: input.media, replyTo: input.replyTo }, await dependencies.linkedUser(input.phone), state, reset);
    if (job) return job;
  }

  // Tenant repair reports (text or photos), access codes and request status.
  if (state.workflow === "idle" || state.workflow === "report" || input.kind === "text") {
    const linked = await dependencies.linkedUser(input.phone);
    if (state.workflow !== "network" && state.workflow !== "rules" && !(input.kind === "text" && isRuleCommand(command))) {
      const report = await dependencies.report({ body: input.body, kind: input.kind, messageId: input.messageId, media: input.media }, linked, state, reset);
      if (report) return report;
    }
  }

  if (input.kind === "text") {
    const linked = await dependencies.linkedUser(input.phone);
    // Maintenance professionals answering invitations and checking their own jobs.
    if (state.workflow !== "network" && state.workflow !== "rules") {
      const provider = await dependencies.providerMessage(input.phone, command, linked, state);
      if (provider) return provider;
    }
    // Landlords managing routing rules. Every change is confirmed first.
    if (state.workflow !== "network") {
      const rules = await dependencies.rules(command, input.body.trim(), linked, state, reset);
      if (rules) return rules;
    }
    // Landlords managing their network. Material changes need an explicit confirm.
    if (state.workflow !== "rules") {
      const network = await dependencies.network(command, input.body.trim(), linked, state, reset);
      if (network) return network;
    }
    // Landlord questions and notification settings. Phrases meaning a change are rewritten into
    // the confirmed command flows above instead of being executed here.
    if (state.workflow === "idle") {
      const answer = await dependencies.landlord(input.body, linked, state);
      if (answer && "rewrite" in answer) {
        const rewritten = answer.rewrite === "rules" ? await dependencies.rules("rules", "rules", linked, state, reset) : await dependencies.network(answer.rewrite, answer.rewrite, linked, state, reset);
        if (rewritten) return answer.rewrite === "rules" ? { ...rewritten, reply: `${rewritten.reply}
To set a limit, reply set limit rule <number> <amount>, for example set limit rule 1 500.` } : rewritten;
      } else if (answer) {
        return answer;
      }
    }
  }

  if (input.kind === "text" && /^(link|link account|connect|connect account)$/.test(command)) {
    const linked = await dependencies.linkedUser(input.phone);
    if (linked) return { state, reply: `This number is already linked to ${linked.user.displayName}. Reply account to see it, or unlink to disconnect it.` };
    if (state.workflow !== "idle") return { state: { ...state, paused: true }, reply: "You have an unfinished request saved. Reply resume to continue it, or cancel and then link." };
    return { state: { ...reset(), workflow: "link", step: "link_method" }, reply: methodPrompt(input.phone) };
  }
  if (input.kind === "text" && /^(account|my account)$/.test(command)) {
    const linked = await dependencies.linkedUser(input.phone);
    if (!linked) return { state, reply: "This WhatsApp number is not linked to a NesAfric account. Reply link to connect it." };
    return { state, reply: formatAccountSummary(linked.user.displayName, await dependencies.roles(linked.user.id)) };
  }
  if (input.kind === "text" && command === "unlink") {
    const removed = await dependencies.unlink(input.phone, input.organisationId);
    return { state, reply: removed ? "This WhatsApp number is no longer linked to your NesAfric account. Reply link to connect it again." : "This WhatsApp number is not linked to a NesAfric account." };
  }

  // The first reply to a tenant invitation (U17) explains how to verify it; it links nothing itself.
  if (input.kind === "text" && state.workflow === "idle") {
    const guidance = await dependencies.invitationReply({ address: whatsappAddress(input.phone), conversationId: input.conversationId, linked: Boolean(await dependencies.linkedUser(input.phone)) });
    if (guidance) return { state, reply: guidance };
  }

  const result = await dependencies.engine(input);
  // Anything not understood on the first turn, or between tasks, gets the welcome menu.
  if (state.workflow === "idle" && result.reply.startsWith("Would you like to find a property, find a service provider")) return { ...result, ...welcomeReply(await greeting(), "I did not catch that.\n\n") };
  if (result.reply === "Are you looking to rent or buy?" && !result.interactive) return { ...result, interactive: rentOrBuyButtons(result.reply) };
  // On the official number registration and listing happen here, not only on the website.
  if (result.reply.startsWith("Continue securely in your NesAfric account")) {
    const reply = "You can register or list right here on WhatsApp. Reply register agency, register agent, register services, or register (landlords). To list a property, reply list a property.";
    return { ...result, state: reset(), reply, interactive: replyButtons(reply, [{ id: "register agency", title: "Register agency" }, { id: "register services", title: "Register provider" }, { id: "list a property", title: "List a property" }]) };
  }
  if (!result.reply.includes(MAIN_MENU)) return result;
  // The official number has its own welcome (see welcome.ts).
  const [before, after] = result.reply.split(MAIN_MENU);
  return { ...result, ...welcomeReply(await greeting(), before, after) };
}

const CHANGE_FILTERS_PROMPT = "Tell me what to change, for example:\n• in East Legon (area)\n• under 5000 a month (budget)\n• 2 bedrooms\n• apartment, house, land or office (type)\nI'll search again with the new filters. Reply new search to start over.";

const AGENT_AREA_PROMPT = "Which area should I search for agents? For example East Legon, Kumasi or Takoradi.\nOnly agents and agencies verified by NesAfric are shown.";

async function findAgents(said: string, state: AssistantState, reset: () => AssistantState, dependencies: Dependencies): Promise<OfficialResult> {
  const more = said.toLowerCase() === "more";
  if (more && !state.agentArea) return { state, reply: AGENT_AREA_PROMPT };
  if (more && !state.hasMore) return { state, reply: "There are no more agents for that area. Send another area, or reply menu." };
  if (!more && (said.length < 2 || said.length > 120)) return { state, reply: AGENT_AREA_PROMPT };
  const area = more ? state.agentArea! : said;
  const page = more ? state.page + 1 : 1;
  const found = await dependencies.agents(area, page);
  const next: AssistantState = { ...reset(), workflow: "agent_search", agentArea: area, page, hasMore: found.hasMore, results: [] };
  if (!found.ids.length) return { state: next, reply: page === 1 ? `No verified agents list ${area} as an area they cover yet. Send another area, or reply menu.` : "There are no more agents for that area. Send another area, or reply menu." };
  return { state: next, reply: `Verified agents for ${area}:\n\n${found.cards.join("\n\n")}\n\nOpen a profile to see their listings and contact them.${found.hasMore ? " Reply more for others." : ""} Send another area to search again, or reply menu.` };
}

async function continueLink(input: OfficialInput, state: AssistantState, reset: () => AssistantState, dependencies: Dependencies): Promise<OfficialResult> {
  const body = input.body.trim();
  const command = body.toLowerCase();
  const redactInbound = state.step === "link_code";
  if (command === "cancel" || command === "menu") {
    const greeting = greetingLine(dependencies.now?.() ?? new Date(), input.profileName);
    return { state: reset(), redactInbound, ...welcomeReply(greeting, "Account linking cancelled. Nothing was changed.\n\n") };
  }
  if (input.kind !== "text") return { state, reply: "Please reply with text to continue linking, or cancel.", redactInbound };

  if (state.step === "link_method") {
    const channel = command === "sms" || command === "1" ? "sms" as const : EMAIL.test(body) ? "email" as const : null;
    if (!channel) return { state, reply: methodPrompt(input.phone) };
    const identifier = channel === "sms" ? whatsappAddress(input.phone) : body.toLowerCase();
    try {
      // The same answer whether or not an account exists; only a verified code reveals that.
      const sent = await dependencies.requestOtp({ mode: "login", channel, identifier });
      return {
        state: { ...state, step: "link_code", link: { channel, identifier, challengeId: sent.challengeId, failures: 0 } },
        reply: `I sent a 6-digit code to ${sent.destination}. Reply with the code here. It expires at ${sent.expiresAt.toISOString().slice(11, 16)} UTC. NesAfric staff will never ask you for it.\nReply resend for a new code or cancel to stop.`,
      };
    } catch (error) {
      if (error instanceof AppError && error.status === 503 && channel === "sms") return { state, reply: "Text-message codes are unavailable right now. Send the email address on your NesAfric account instead, or try again later." };
      if (error instanceof AppError && error.status < 500) return { state, reply: error.message };
      if (error instanceof AppError) return { state, reply: "Verification codes are unavailable right now. Please try again later, or reply cancel." };
      throw error;
    }
  }

  const link = state.link;
  if (!link) return { state: { ...state, step: "link_method" }, reply: methodPrompt(input.phone), redactInbound };
  if (command === "resend") return { state: { ...state, step: "link_method", link: undefined }, reply: methodPrompt(input.phone), redactInbound: true };
  if (!/^\d{6}$/.test(body)) return { state, reply: "Send the 6-digit code, resend for a new one, or cancel.", redactInbound: true };
  try {
    const { user } = await dependencies.verifyOtp({ challengeId: link.challengeId, channel: link.channel, identifier: link.identifier, code: body });
    await dependencies.link(input.phone, user.id, link.channel === "sms" ? "SMS_OTP" : "EMAIL_OTP", input.organisationId);
    const summary = formatAccountSummary(user.displayName, await dependencies.roles(user.id));
    return { state: reset(), reply: `This WhatsApp number is now linked to your NesAfric account.\n\n${summary}`, redactInbound: true };
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    if (error.code === "OTP_NO_ACCOUNT") {
      return { state: reset(), reply: `No NesAfric account uses ${link.channel === "sms" ? "this number" : "that email address"} yet. Create one at ${absoluteUrl("/register")}, then reply link here.`, redactInbound: true };
    }
    if (error.code === "OTP_EXPIRED") return { state: { ...state, step: "link_method", link: undefined }, reply: "That code has expired.\n" + methodPrompt(input.phone), redactInbound: true };
    if (error.code === "OTP_INVALID") {
      const failures = link.failures + 1;
      if (failures >= MAX_CODE_FAILURES) return { state: reset(), reply: "Too many incorrect codes. Nothing was linked. Reply link to start again.", redactInbound: true };
      return { state: { ...state, link: { ...link, failures } }, reply: "That code is incorrect or has expired. Check it and send it again, or reply resend.", redactInbound: true };
    }
    if (error.status < 500) return { state, reply: error.message, redactInbound: true };
    return { state, reply: "I could not check the code right now. Please send it again in a moment.", redactInbound: true };
  }
}
