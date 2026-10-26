import { db } from "@/platform/database/client";
import type { WhatsAppInteractive } from "@/modules/conversations/channels/whatsapp-interactive";
import { whatsappAddress } from "@/modules/whatsapp-assistant/identity";
import { getFlowDraft } from "@/modules/whatsapp-assistant/business/drafts";
import { promptFor as guidedPrompt } from "@/modules/whatsapp-assistant/business/guided";
import { listingFlow } from "@/modules/whatsapp-assistant/business/listing";
import { registrationFlow } from "@/modules/whatsapp-assistant/business/registration";
import { findOpenDraft } from "@/modules/whatsapp-assistant/onboarding/draft";
import { promptFor as onboardingPrompt } from "@/modules/whatsapp-assistant/onboarding/flow";
import type { AssistantState } from "@/modules/whatsapp-assistant/schemas";
import { flowLog, submissionHash } from "./handlers";
import { FLOW_COPY, flowMessage, MENU_FLOWS } from "./messages";
import { isFlowKey } from "./registry";
import { verifyFlowToken, verifyOutcome } from "./token";

export type CompletionResult = { state: AssistantState; reply: string; handoff?: boolean; interactive?: WhatsAppInteractive; /** Run this chat command next, as if the person typed it. */ command?: string };

/**
 * A finished Flow (the inbound nfm_reply). Acts only on an outcome NesAfric signed for a
 * flow_token it issued to this same number; anything else is answered without acting on it.
 */
export async function completeFlow(input: { phone: string; organisationId: string; flowResponse?: string }, state: AssistantState, reset: () => AssistantState): Promise<CompletionResult> {
  const stale: CompletionResult = { state: reset(), reply: "That form has expired or could not be read, so nothing was saved from it. Reply menu to start again." };
  let response: Record<string, unknown>;
  try { response = JSON.parse(input.flowResponse ?? "") as Record<string, unknown>; } catch { return stale; }
  const token = typeof response.flow_token === "string" ? response.flow_token : "";
  const claims = verifyFlowToken(token);
  if (!claims || claims.a !== whatsappAddress(input.phone) || claims.o !== input.organisationId) return stale;
  const { flow_token: _token, receipt, ...rest } = response;
  const outcome = Object.fromEntries(Object.entries(rest).filter(([, value]) => typeof value === "string")) as Record<string, string>;
  // A Flow closed from a screen without an endpoint outcome (for example after showing a profile link).
  if (!outcome.outcome) return { state, reply: "Thanks. Reply menu for anything else." };
  if (!verifyOutcome(token, outcome, receipt)) return stale;
  flowLog("whatsapp.flows.completed", { flow: claims.f, outcome: outcome.outcome, session: submissionHash(claims.n) });

  switch (outcome.outcome) {
    case "open_flow": {
      if (!isFlowKey(outcome.flow)) return stale;
      const interactive = flowMessage(outcome.flow, { address: claims.a, organisationId: claims.o, listingId: outcome.listing });
      return interactive
        ? { state: { ...reset(), selectedListingId: outcome.listing }, reply: FLOW_COPY[outcome.flow].body, interactive }
        : { state: reset(), reply: `Reply details to continue in the chat.` };
    }
    case "viewing_requested":
      return { state: { ...reset(), lastRequest: { listingId: outcome.listing, leadId: outcome.lead, ...(outcome.reference !== outcome.lead ? { viewingId: outcome.reference } : {}) } }, reply: `Viewing request saved. Reference: ${outcome.reference}. The appointment is not confirmed yet: the agent confirms the time with you. Reply status to check it.` };
    case "viewing_exists":
      return { state: reset(), reply: `You already have a viewing request for this property (reference ${outcome.reference}), so no second one was made. Reply status to check it.` };
    case "stay_requested":
      return { state: { ...reset(), selectedListingId: outcome.listing }, reply: `Booking request sent. Reference: ${outcome.reference}.\nCheck-in ${outcome.check_in}, check-out ${outcome.check_out}.\nThe host confirms it with you, and a receipt is on its way to your email. Nothing is paid yet.` };
    case "inquiry_sent":
      return { state: { ...reset(), lastRequest: { listingId: outcome.listing, leadId: outcome.lead } }, reply: `Question sent to the listing team. Reference: ${outcome.reference}. Reply status to check it.` };
    case "draft": {
      const draft = outcome.draft ? await getFlowDraft(outcome.draft, (await db.whatsAppFlowDraft.findUnique({ where: { id: outcome.draft }, select: { userId: true } }))?.userId ?? "") : null;
      if (!draft || draft.status !== "OPEN") return stale;
      const prompt = outcome.kind === "listing" ? await guidedPrompt(listingFlow(), draft) : await guidedPrompt(registrationFlow(), draft);
      return { state: { ...reset(), workflow: "business", business: { draftId: draft.id } }, reply: `Details saved.\n\n${prompt.reply}`, interactive: prompt.interactive };
    }
    case "onboarding": {
      const draft = await findOpenDraft(claims.a);
      if (!draft || draft.id !== outcome.draft) return stale;
      return { state: { ...reset(), workflow: "onboarding" }, reply: `Saved your first property.\n\n${onboardingPrompt(draft, input.phone)}` };
    }
    case "tenancy_connected":
      return { state: reset(), reply: "Your tenancy is connected. To report a problem at your home, reply report, or open the repair form with forms." };
    case "maintenance_reported":
      return { state: reset(), reply: `Your report was sent to your landlord. Reference: ${outcome.reference}. Reply status to follow it.` };
    case "command":
      return { state: reset(), reply: "", command: outcome.command };
    case "support":
      return { state: reset(), reply: `Thanks. A member of the NesAfric team will reply here.\nYour message (${(outcome.topic ?? "OTHER").toLowerCase().replaceAll("_", " ")}): ${outcome.summary ?? ""}`, handoff: true };
    default:
      return stale;
  }
}

/** The "forms" command: a list of the Flows configured for this number. */
export function formsMenu(input: { address: string; organisationId: string }, state: AssistantState): CompletionResult | null {
  const available = MENU_FLOWS.filter((flow) => flowMessage(flow, input));
  if (!available.length) return null;
  return {
    state,
    reply: `Choose a form:\n${available.map((flow, index) => `${index + 1}. ${FLOW_COPY[flow].title}`).join("\n")}\nReply form 1, form 2…`,
    interactive: { type: "list", body: "Choose a form. Each one opens inside WhatsApp.", button: "Choose a form", sections: [{ rows: available.map((flow, index) => ({ id: `form ${index + 1}`, title: FLOW_COPY[flow].title.slice(0, 24) })) }] },
  };
}

/** "form 3": opens that Flow. */
export function openForm(choice: number, input: { address: string; organisationId: string }, state: AssistantState): CompletionResult | null {
  const available = MENU_FLOWS.filter((flow) => flowMessage(flow, input));
  const flow = available[choice - 1];
  if (!flow) return null;
  return { state, reply: FLOW_COPY[flow].body, interactive: flowMessage(flow, input) };
}
