import { absoluteUrl } from "@/platform/brand";
import { AppError } from "@/platform/errors";
import { maskPhone } from "@/platform/identity/phone";
import { requestOtp, verifyOtp } from "@/modules/identity/otp";
import { advanceConversation, MAIN_MENU, type EngineInput } from "./engine";
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

export type OfficialInput = EngineInput & { organisationId: string; media?: { id: string; mimeType?: string }; /** Provider message id this message replied to (quick-reply buttons). */ replyTo?: string };
export type OfficialResult = { state: AssistantState; reply: string; handoff?: boolean; /** The inbound text was a one-time code and must not stay in the transcript. */ redactInbound?: boolean };

export const OFFICIAL_MENU_SUFFIX = "\n\nLandlords and property managers: reply register to set up your properties right here.\nAlready use NesAfric? Reply link to connect this WhatsApp number to your account, or account to see your properties, tenancies and jobs.";
const START_ONBOARDING = /^(4|register|register landlord|landlord|property manager|add my property|add my properties|onboard|set up my properties)$/;
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
};
const defaults: Dependencies = { engine: advanceConversation, requestOtp, verifyOtp, linkedUser: linkedWhatsAppUser, link: linkWhatsAppIdentity, unlink: unlinkWhatsAppIdentity, roles: resolveAccountRoles, onboarding: advanceOnboarding, openDraft: findOpenDraft, providerMessage: handleProviderMessage, network: advanceNetwork, report: advanceReport, rules: advanceRules, jobs: advanceJobs, landlord: answerLandlord };

const methodPrompt = (phone: string) => `To connect this number I need to confirm the NesAfric account is yours.\nReply sms to get a 6-digit code by text message at ${maskPhone(whatsappAddress(phone))}, or send the email address on your NesAfric account to get it by email.\nReply cancel to stop.`;

/**
 * The official NesAfric number. Account linking and account views are deterministic commands: no
 * model output decides who someone is or what they can see. Everything else is the marketplace
 * assistant.
 */
export async function advanceOfficialConversation(input: OfficialInput, dependencies: Dependencies = defaults): Promise<OfficialResult> {
  const parsed = assistantStateSchema.safeParse(input.state ?? {});
  const state = parsed.success ? structuredClone(parsed.data) : initialState();
  const command = input.body.trim().toLowerCase();
  const reset = (): AssistantState => ({ ...initialState(), lastRequest: state.lastRequest });

  if (state.workflow === "link") return continueLink(input, state, reset, dependencies);

  // Onboarding keeps its progress in its own draft, so it survives conversation resets.
  const startsOnboarding = input.kind === "text" && (START_ONBOARDING.test(command) || (command === "resume" && state.workflow === "idle" && Boolean(await dependencies.openDraft(whatsappAddress(input.phone)))));
  if (state.workflow === "onboarding" || startsOnboarding) {
    const result = await dependencies.onboarding({ phone: input.phone, messageId: input.messageId, body: input.body, kind: input.kind, organisationId: input.organisationId, defaultCountry: input.defaultCountry, defaultCurrency: input.defaultCurrency });
    return { state: result.exit ? reset() : { ...reset(), workflow: "onboarding" }, reply: result.reply, redactInbound: result.redactInbound };
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

  const result = await dependencies.engine(input);
  return { ...result, reply: result.reply.includes(MAIN_MENU) ? result.reply.replace(MAIN_MENU, MAIN_MENU + OFFICIAL_MENU_SUFFIX) : result.reply };
}

async function continueLink(input: OfficialInput, state: AssistantState, reset: () => AssistantState, dependencies: Dependencies): Promise<OfficialResult> {
  const body = input.body.trim();
  const command = body.toLowerCase();
  const redactInbound = state.step === "link_code";
  if (command === "cancel" || command === "menu") return { state: reset(), reply: "Account linking cancelled. Nothing was changed.\n\n" + MAIN_MENU + OFFICIAL_MENU_SUFFIX, redactInbound };
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
