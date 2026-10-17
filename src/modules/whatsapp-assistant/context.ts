import type { InboundLocation, InboundMedia } from "./cloud-api";
import { choices, text as textReply, type Reply, type ReplyOption } from "./messages";
import type { ContactRow } from "./store";
import type { Expectation, SessionState, WorkflowKey } from "./state";
import type { Intent } from "./nlu";

export type EngineInput = {
  /** Our stored inbound row id: the root of every idempotency key derived from this message. */
  inboundId: string;
  text?: string;
  /** Interactive reply id, or an option the typed text matched. */
  choiceId?: string;
  media?: InboundMedia;
  location?: InboundLocation;
};

export type StartSeed = { text?: string; intent?: Intent; preset?: string };

export interface Workflow {
  readonly key: WorkflowKey;
  /** Begin the workflow. `seed.text` is the message that started it, already parsed for fields. */
  start(ctx: Ctx, seed: StartSeed): Promise<void>;
  /** Handle the next message for the current step. */
  handle(ctx: Ctx): Promise<void>;
  /** Re-ask the current step (after "resume" or an unrecognised answer). */
  reprompt(ctx: Ctx): Promise<void>;
}

/**
 * Everything a workflow step may use: the person, their durable state, this message, and reply
 * helpers. Workflows never touch the database for state or send messages themselves — the
 * processor persists `state` and queues `replies` atomically after the step returns.
 */
export class Ctx {
  readonly replies: Reply[] = [];
  /** Set when a step wants another workflow to take over within the same message. */
  handoff: { workflow: WorkflowKey; seed: StartSeed } | null = null;

  constructor(
    readonly contact: ContactRow,
    public state: SessionState,
    readonly input: EngineInput,
    readonly now: Date,
  ) {}

  say(reply: Reply | string) {
    this.replies.push(typeof reply === "string" ? textReply(reply) : reply);
  }

  /** Asks a question with fixed choices; typed numbers or titles map back to these options. */
  ask(body: string, options: ReplyOption[], button = "Choose") {
    this.replies.push(choices(body, options, button));
    // Kept even when rendered as a plain numbered menu (more than 10 options).
    this.state.options = options;
    this.state.expects = "choice";
  }

  /** Asks an open question (free text, media or both). */
  prompt(body: string, expects: Expectation = "text", options?: ReplyOption[]) {
    if (options?.length) {
      this.replies.push(choices(body, options));
      this.state.options = options;
    } else {
      this.replies.push(textReply(body));
      this.state.options = undefined;
    }
    this.state.expects = expects;
  }

  go(workflow: WorkflowKey, step: string, data?: Record<string, unknown>) {
    this.state.workflow = workflow;
    this.state.step = step;
    if (data) this.state.data = data;
  }

  step(step: string) {
    this.state.step = step;
  }

  finish() {
    this.state.workflow = null;
    this.state.step = null;
    this.state.data = {};
    this.state.options = undefined;
    this.state.expects = undefined;
  }

  get text() {
    return this.input.text?.trim() ?? "";
  }

  get choice() {
    return this.input.choiceId;
  }

  data<T = Record<string, unknown>>() {
    return this.state.data as T;
  }

  /** An idempotency key for an action triggered by this exact message. */
  actionKey(kind: string) {
    return `${kind}:${this.input.inboundId}`;
  }
}
