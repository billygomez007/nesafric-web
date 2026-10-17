import { db } from "@/platform/database/client";
import { AppError } from "@/platform/errors";
import { aiClassifyIntent } from "./ai";
import { AccountVerificationRequired, completeAccountVerification, startAccountVerification } from "./identity";
import { Ctx, type StartSeed, type Workflow } from "./context";
import { detectCommand, detectIntents, matchOption, type Intent } from "./nlu";
import { parseReference } from "./references";
import { BUSINESS_WORKFLOWS, WORKFLOW_TITLES, type WorkflowKey } from "./state";
import { recordEvent } from "./store";
import { businessRegistration } from "./workflows/business-registration";
import { listing } from "./workflows/listing";
import { propertyInquiry } from "./workflows/property-inquiry";
import { propertySearch } from "./workflows/property-search";
import { providerRegistration } from "./workflows/provider-registration";
import { serviceQuote, serviceSearch } from "./workflows/service-search";
import { status, support } from "./workflows/status";

export const WORKFLOWS: Record<WorkflowKey, Workflow> = {
  property_search: propertySearch,
  property_inquiry: propertyInquiry,
  service_search: serviceSearch,
  service_quote: serviceQuote,
  business_registration: businessRegistration,
  provider_registration: providerRegistration,
  listing,
  status,
  support,
};

const INTENT_ROUTES: Record<Intent, { workflow: WorkflowKey; preset?: string } | null> = {
  greeting: null,
  property_search: { workflow: "property_search" },
  service_search: { workflow: "service_search" },
  register_business: { workflow: "business_registration" },
  register_agent: { workflow: "business_registration", preset: "AGENT" },
  register_landlord: { workflow: "business_registration", preset: "LANDLORD" },
  register_provider: { workflow: "provider_registration" },
  list_property: { workflow: "listing" },
  edit_listing: { workflow: "listing", preset: "edit" },
  status: { workflow: "status" },
  support: { workflow: "support" },
};

/** Main-menu option ids: "menu:<intent>". */
const MENU = [
  { id: "menu:property_search", title: "Find a property" },
  { id: "menu:service_search", title: "Find a service provider" },
  { id: "menu:register_business", title: "Register my business", description: "Agency, brokerage, developer, property manager" },
  { id: "menu:register_agent_or_landlord", title: "Agent or landlord sign-up" },
  { id: "menu:list_property", title: "List a property" },
  { id: "menu:register_provider", title: "Register a service business" },
  { id: "menu:status", title: "Check my application/listing" },
  { id: "menu:support", title: "Talk to support" },
];

const WELCOME = "Welcome to NesAfric! 🏡\nI can help you find properties, connect with trusted service professionals, or register your real estate business.";

export function showMenu(ctx: Ctx, intro?: string) {
  ctx.state.options = undefined;
  ctx.state.expects = "choice";
  ctx.ask(`${intro ? `${intro}\n\n` : ""}What would you like to do? You can also just tell me, e.g. _"2-bedroom apartment in East Legon for rent"_ or _"I need a plumber in Spintex"_.`, MENU, "Menu");
}

const HELP = [
  "*How to use NesAfric on WhatsApp*",
  "• Just tell me what you need, e.g. _\"house for sale in Kumasi under 1 million\"_.",
  "• *menu* — main menu (your progress is saved)",
  "• *resume* — continue where you left off",
  "• *cancel* — stop what you're doing",
  "• *status* — check your applications, listings and requests",
  "• *support* — talk to the NesAfric team",
  "• *stop* — no more notifications from us",
].join("\n");

async function startWorkflow(ctx: Ctx, key: WorkflowKey, seed: StartSeed) {
  const current = ctx.state.workflow;
  // Leaving an unfinished registration or listing keeps it, so "resume" can bring it back.
  if (current && current !== key && BUSINESS_WORKFLOWS.includes(current) && ctx.state.step) {
    ctx.state.paused = { workflow: current, step: ctx.state.step, data: ctx.state.data, pausedAt: ctx.now.toISOString() };
    ctx.say(`I've saved your unfinished ${WORKFLOW_TITLES[current]} — reply *resume* to continue it later.`);
  }
  // Inquiry/quote read the search they came from in start(); "back to results" restores it.
  const keepsData = key === "property_inquiry" || key === "service_quote" || (key === "property_search" && seed.preset === "resume-results");
  if (!keepsData) ctx.state.data = {};
  ctx.state.options = undefined;
  await recordEvent("workflow_started", ctx.contact.id, { workflow: key });
  await WORKFLOWS[key].start(ctx, seed);
}

async function startIntent(ctx: Ctx, intents: Intent[], text: string) {
  const [first, ...rest] = intents;
  const route = INTENT_ROUTES[first];
  ctx.state.pendingIntents = rest.filter((intent) => INTENT_ROUTES[intent]).map((intent) => ({ intent, text }));
  if (!route) return showMenu(ctx, WELCOME);
  if (ctx.state.pendingIntents.length) {
    const next = INTENT_ROUTES[ctx.state.pendingIntents[0].intent]!;
    ctx.say(`I'll help with that in two parts — first the ${WORKFLOW_TITLES[route.workflow]}, then the ${WORKFLOW_TITLES[next.workflow]}.`);
  }
  await startWorkflow(ctx, route.workflow, { text, intent: first, preset: route.preset });
}

async function handleMenuChoice(ctx: Ctx, choice: string) {
  const key = choice.slice("menu:".length);
  if (key === "register_agent_or_landlord") {
    ctx.finish();
    ctx.ask("Which describes you?", [
      { id: "menu:register_agent", title: "Real estate agent" },
      { id: "menu:register_landlord", title: "Landlord / owner" },
      { id: "menu:register_developer", title: "Developer" },
    ]);
    return;
  }
  if (key === "register_developer") return startWorkflow(ctx, "business_registration", { preset: "DEVELOPER" });
  const route = INTENT_ROUTES[key as Intent];
  if (!route) return showMenu(ctx);
  await startWorkflow(ctx, route.workflow, { intent: key as Intent, preset: route.preset });
}

async function resume(ctx: Ctx) {
  const paused = ctx.state.paused;
  if (paused) {
    ctx.state.workflow = paused.workflow;
    ctx.state.step = paused.step;
    ctx.state.data = paused.data;
    ctx.state.paused = null;
    ctx.say(`Welcome back — continuing your ${WORKFLOW_TITLES[paused.workflow]}.`);
    return WORKFLOWS[paused.workflow].reprompt(ctx);
  }
  if (ctx.state.workflow) return WORKFLOWS[ctx.state.workflow].reprompt(ctx);
  showMenu(ctx, "There's nothing to resume right now.");
}

/**
 * Handles one inbound message. Mutates `ctx.state` and appends to `ctx.replies`; the processor
 * persists both atomically. Message content is only ever parsed into data — it can never change
 * permissions, select a tool, or trigger an action without the workflow's own checks.
 */
export async function handleMessage(ctx: Ctx) {
  const isNewContact = (await db.whatsAppInboundMessage.count({ where: { contactId: ctx.contact.id } })) <= 1;
  const command = ctx.input.media || ctx.input.choiceId ? null : detectCommand(ctx.text);

  if (ctx.state.verification && command !== "menu" && command !== "cancel" && command !== "stop" && command !== "help") {
    return handleVerificationAnswer(ctx);
  }
  if (!ctx.input.media && !ctx.input.choiceId && /^(link|connect)( my)?( nesafric)? account$/i.test(ctx.text)) {
    if (ctx.contact.userId) {
      ctx.say("This WhatsApp number is already linked to your NesAfric account. ✅");
      return;
    }
    return beginVerification(ctx, new AccountVerificationRequired(ctx.contact.profileName ?? ""), null);
  }

  switch (command) {
    case "stop":
      await db.whatsAppContact.update({ where: { id: ctx.contact.id }, data: { optedOutAt: ctx.now } });
      await recordEvent("opted_out", ctx.contact.id);
      ctx.say("You won't receive notifications from NesAfric on WhatsApp any more. You can still message us anytime; reply *start* to turn notifications back on.");
      return;
    case "start":
      if (ctx.contact.optedOutAt) {
        await db.whatsAppContact.update({ where: { id: ctx.contact.id }, data: { optedOutAt: null } });
        ctx.say("Notifications are back on. ✅");
      }
      return showMenu(ctx, ctx.contact.optedOutAt ? undefined : WELCOME);
    case "help":
      ctx.say(HELP);
      return;
    case "menu": {
      ctx.state.verification = null;
      if (ctx.state.workflow && BUSINESS_WORKFLOWS.includes(ctx.state.workflow) && ctx.state.step) {
        ctx.state.paused = { workflow: ctx.state.workflow, step: ctx.state.step, data: ctx.state.data, pausedAt: ctx.now.toISOString() };
        ctx.finish();
        return showMenu(ctx, `Your ${WORKFLOW_TITLES[ctx.state.paused.workflow]} is saved — reply *resume* to continue it.`);
      }
      ctx.finish();
      return showMenu(ctx);
    }
    case "cancel": {
      ctx.state.verification = null;
      const current = ctx.state.workflow;
      const draftListingId = current === "listing" ? (ctx.state.data.listingId as string | undefined) : undefined;
      ctx.finish();
      ctx.state.pendingIntents = undefined;
      if (current) await recordEvent("workflow_cancelled", ctx.contact.id, { workflow: current, step: ctx.state.step });
      return showMenu(ctx, current
        ? `Okay, I've stopped the ${WORKFLOW_TITLES[current]}.${draftListingId ? " Your draft listing is still saved — reply *edit listing* to continue it." : " Anything already submitted is unaffected."}`
        : undefined);
    }
    case "resume":
      return resume(ctx);
    case "status":
      return startWorkflow(ctx, "status", {});
    case "support":
      return startWorkflow(ctx, "support", {});
    default:
      break;
  }

  // A typed reply ("2", or an option's title) selects one of the options just offered.
  if (!ctx.input.choiceId && ctx.state.options?.length) {
    const option = matchOption(ctx.text, ctx.state.options);
    if (option) ctx.input.choiceId = option.id;
  }
  const choice = ctx.input.choiceId;
  if (choice === "menu") {
    ctx.finish();
    return showMenu(ctx);
  }
  if (choice?.startsWith("menu:")) return handleMenuChoice(ctx, choice);

  if (!ctx.state.workflow && parseReference(ctx.text)) return startWorkflow(ctx, "status", { text: ctx.text });

  if (ctx.state.workflow) {
    // When the step offered fixed choices and the person said something else entirely, a clear
    // new request ("find me a plumber") switches task instead of being rejected.
    if (!choice && !ctx.input.media && ctx.state.expects === "choice") {
      const intents = detectIntents(ctx.text);
      const route = intents[0] ? INTENT_ROUTES[intents[0]] : null;
      if (route && route.workflow !== ctx.state.workflow) return startIntent(ctx, intents, ctx.text);
    }
    await WORKFLOWS[ctx.state.workflow].handle(ctx);
    return;
  }

  if (ctx.input.media) {
    ctx.say("Thanks! I can only use photos and documents during a registration or listing. Tell me what you'd like to do first.");
    return showMenu(ctx);
  }

  let intents = detectIntents(ctx.text);
  if (!intents.length || intents[0] === "greeting") {
    const fromAI = intents[0] === "greeting" ? [] : await aiClassifyIntent(ctx.text);
    if (fromAI.length) intents = fromAI;
  }
  if (!intents.length || intents[0] === "greeting") {
    if (!intents.length && ctx.text) await recordEvent("intent_unclear", ctx.contact.id, {});
    return showMenu(ctx, isNewContact || intents[0] === "greeting" ? WELCOME : "Sorry, I didn't quite get that.");
  }
  if (isNewContact) ctx.say("Welcome to NesAfric! 🏡");
  return startIntent(ctx, intents, ctx.text);
}

/**
 * Sends the website's SMS sign-in code to this WhatsApp number. The step that needed an account is
 * remembered and re-run once the code is confirmed; nothing is submitted before that.
 */
async function beginVerification(ctx: Ctx, required: AccountVerificationRequired, replay: { text?: string; choiceId?: string } | null) {
  try {
    const challenge = await startAccountVerification(ctx.contact);
    ctx.state.verification = { challengeId: challenge.challengeId, destination: challenge.destination, displayName: required.displayName, replay };
    await recordEvent("account_verification_sent", ctx.contact.id, {});
    ctx.say(`To keep your account safe, we've sent a 6-digit code by SMS to ${challenge.destination}. Please reply with the code.\n\n(Reply *resend* for a new code, or *cancel* to stop.)`);
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    await recordEvent("account_verification_unavailable", ctx.contact.id, { code: error.code });
    ctx.say(`I couldn't send a verification code just now: ${error.message} Your answers so far are saved — reply *resume* to try again.`);
  }
}

async function handleVerificationAnswer(ctx: Ctx) {
  const verification = ctx.state.verification!;
  if (/^(resend|new code|send again)$/i.test(ctx.text)) {
    return beginVerification(ctx, new AccountVerificationRequired(verification.displayName), verification.replay);
  }
  const code = ctx.text.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(code)) {
    ctx.say(`Please reply with the 6-digit code we sent by SMS to ${verification.destination}, *resend* for a new code, or *cancel*.`);
    return;
  }
  try {
    const { user, created } = await completeAccountVerification(ctx.contact, { challengeId: verification.challengeId, code, displayName: verification.displayName });
    ctx.state.verification = null;
    await recordEvent("account_linked", ctx.contact.id, { created });
    ctx.say(created ? "✅ Number verified — your NesAfric account is ready." : `✅ Verified — this WhatsApp number is now linked to your NesAfric account (${user.displayName}).`);
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    if (error.code === "WHATSAPP_STAFF_ACCOUNT") ctx.state.verification = null;
    ctx.say(error.message);
    return;
  }
  // Re-run the answer that needed the account, as a fresh step of this message.
  if (verification.replay && ctx.state.workflow) {
    ctx.input.text = verification.replay.text;
    ctx.input.choiceId = verification.replay.choiceId;
    await WORKFLOWS[ctx.state.workflow].handle(ctx);
  }
}

/**
 * Runs `handleMessage`, then any workflow-to-workflow handoffs it requested (e.g. a search result
 * "Request a viewing" starting the inquiry workflow). Bounded so a bug can never loop forever.
 */
export async function runEngine(ctx: Ctx) {
  try {
    await handleMessage(ctx);
    for (let hops = 0; ctx.handoff && hops < 3; hops += 1) {
      const { workflow, seed } = ctx.handoff;
      ctx.handoff = null;
      await startWorkflow(ctx, workflow, seed);
    }
  } catch (error) {
    if (!(error instanceof AccountVerificationRequired)) throw error;
    ctx.handoff = null;
    // The answer as resolved (a typed "1" already mapped to its option id), replayed once verified.
    await beginVerification(ctx, error, ctx.state.workflow ? { text: ctx.input.text, choiceId: ctx.input.choiceId } : null);
    return;
  }
  // A finished task with another one waiting from the same message: offer it.
  if (!ctx.state.workflow && ctx.state.pendingIntents?.length && !ctx.replies.some((reply) => reply.kind === "buttons" || reply.kind === "list")) {
    const next = ctx.state.pendingIntents[0];
    const route = INTENT_ROUTES[next.intent]!;
    ctx.ask(`You also asked about a ${WORKFLOW_TITLES[route.workflow]}. Shall we do that now?`, [{ id: `menu:${next.intent}`, title: "Yes, let's go" }, { id: "menu", title: "Main menu" }]);
    ctx.state.pendingIntents = ctx.state.pendingIntents.slice(1);
  }
}
