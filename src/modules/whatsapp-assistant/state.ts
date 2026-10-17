import type { Intent } from "./nlu";
import type { ReplyOption } from "./messages";

export type WorkflowKey =
  | "property_search"
  | "property_inquiry"
  | "service_search"
  | "service_quote"
  | "business_registration"
  | "provider_registration"
  | "listing"
  | "status"
  | "support";

/** What the current step is waiting for; drives how an unexpected message is treated. */
export type Expectation = "choice" | "text" | "media" | "any";

export type PausedWorkflow = { workflow: WorkflowKey; step: string | null; data: Record<string, unknown>; pausedAt: string };

/**
 * Durable conversation state for one WhatsApp contact. Persisted on every processed message
 * (`WhatsAppAssistantSession`), so a restart, a redeploy or a week's silence never loses progress.
 */
export type SessionState = {
  workflow: WorkflowKey | null;
  step: string | null;
  data: Record<string, unknown>;
  expects?: Expectation;
  /** Options offered by the last prompt, so "2" or a typed title selects the second one. */
  options?: ReplyOption[];
  /** A business workflow set aside with "menu" or by starting something else; "resume" restores it. */
  paused?: PausedWorkflow | null;
  /** Further tasks from a multi-intent message ("an apartment and a plumber"). */
  pendingIntents?: Array<{ intent: Intent; text: string }>;
};

export function emptyState(): SessionState {
  return { workflow: null, step: null, data: {} };
}

/** Reads stored session JSON defensively: anything malformed starts a fresh state. */
export function stateFromSession(session: { workflow: string | null; step: string | null; data: unknown }): SessionState {
  const stored = typeof session.data === "object" && session.data !== null && !Array.isArray(session.data) ? session.data as Record<string, unknown> : {};
  const data = typeof stored.data === "object" && stored.data !== null && !Array.isArray(stored.data) ? stored.data as Record<string, unknown> : {};
  return {
    workflow: (session.workflow as WorkflowKey | null) ?? null,
    step: session.step ?? null,
    data,
    expects: typeof stored.expects === "string" ? stored.expects as Expectation : undefined,
    options: Array.isArray(stored.options) ? stored.options as ReplyOption[] : undefined,
    paused: (stored.paused as PausedWorkflow | null | undefined) ?? null,
    pendingIntents: Array.isArray(stored.pendingIntents) ? stored.pendingIntents as SessionState["pendingIntents"] : undefined,
  };
}

export function stateToSession(state: SessionState) {
  return {
    workflow: state.workflow,
    step: state.step,
    data: JSON.parse(JSON.stringify({
      data: state.data,
      expects: state.expects ?? null,
      options: state.options ?? null,
      paused: state.paused ?? null,
      pendingIntents: state.pendingIntents ?? null,
    })),
  };
}

export const BUSINESS_WORKFLOWS: readonly WorkflowKey[] = ["business_registration", "provider_registration", "listing"];

export const WORKFLOW_TITLES: Record<WorkflowKey, string> = {
  property_search: "property search",
  property_inquiry: "property inquiry",
  service_search: "service provider search",
  service_quote: "service request",
  business_registration: "business registration",
  provider_registration: "service provider registration",
  listing: "property listing",
  status: "status check",
  support: "support request",
};
