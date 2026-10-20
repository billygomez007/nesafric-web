import type { WhatsAppInteractive } from "@/modules/conversations/channels/whatsapp-interactive";
import { applyFlowDraftChange, cancelFlowDraft, type FlowDraft } from "./drafts";
import { cancelPrompt, CONTROL, command, HELP, numbered, readConfirm, reviewButtons, type FlowInput, type FlowResult } from "./common";

export type Prompt = { text: string; interactive?: WhatsAppInteractive };
/** `stay` keeps the person on the same step with a message (for example "Photo 3 of 10 added"). */
export type Answer<D> = { data: D; stay?: string } | { error: string };

/** One question of a guided flow. Steps are asked in order, skipping those whose `when` is false. */
export type Step<D> = {
  id: string;
  /** Shown in the review summary and the edit menu. */
  label: string;
  when?: (data: D) => boolean;
  prompt: (data: D) => Prompt | Promise<Prompt>;
  answer?: (body: string, data: D, input: FlowInput) => Answer<D> | Promise<Answer<D>>;
  /** For steps that take an image. Called once per message (idempotent by message id). */
  media?: (mediaId: string, data: D, input: FlowInput, draft: FlowDraft) => Promise<{ data: D; reply: string; advance?: boolean }>;
  /** Summary line for review; null hides the step there. */
  summary?: (data: D) => string | null;
  /** Steps listed in the edit menu (default true). */
  editable?: boolean;
  /** Runs when the flow moves into this step (for example to create the canonical record the
   * step attaches photos to). An error keeps the person where they were. */
  enter?: (data: D, draft: FlowDraft, input: FlowInput) => Promise<{ data: D } | { error: string }>;
};

export type GuidedFlow<D> = {
  what: string;
  steps: Step<D>[];
  /** Read the draft's data (validated; unknown keys dropped). */
  read: (raw: Record<string, unknown>) => D;
  /** Called when the person confirms the review at the revision they saw. */
  submit: (draft: FlowDraft, input: FlowInput, reviewedRevision: number) => Promise<FlowResult>;
  /** Runs whenever the flow enters review (for example to write the answers to the canonical
   * record and note which version is being reviewed). An error keeps the person where they were. */
  onReview?: (data: D, draft: FlowDraft, input: FlowInput) => Promise<{ data: D } | { error: string }>;
  /** Extra text under the review summary (for example a photo count or a status note). */
  reviewNote?: (data: D, draft: FlowDraft) => Promise<string | null> | string | null;
};

type Meta = { returnToReview?: boolean; history?: string[]; previousStep?: string };
const metaOf = (data: Record<string, unknown>) => (data._meta ?? {}) as Meta;
const withMeta = <D>(data: D, meta: Meta) => ({ ...(data as object), _meta: meta } as D);

const order = <D>(flow: GuidedFlow<D>, data: D) => flow.steps.filter((step) => !step.when || step.when(data));

export async function promptFor<D>(flow: GuidedFlow<D>, draft: FlowDraft): Promise<FlowResult> {
  const data = flow.read(draft.data);
  if (draft.step === "review") return reviewPrompt(flow, draft);
  if (draft.step === "cancel_confirm") return { ...cancelPrompt(flow.what), draftId: draft.id };
  if (draft.step === "edit_pick") return { reply: editMenu(flow, data), draftId: draft.id };
  if (draft.step === "submitting") return { reply: `Your ${flow.what} is being submitted. I'll confirm here in a moment.`, draftId: draft.id };
  const step = flow.steps.find((item) => item.id === draft.step) ?? order(flow, data)[0];
  const prompt = await step.prompt(data);
  return { reply: prompt.text, interactive: prompt.interactive, draftId: draft.id };
}

async function reviewPrompt<D>(flow: GuidedFlow<D>, draft: FlowDraft): Promise<FlowResult> {
  const data = flow.read(draft.data);
  const lines = order(flow, data).map((step) => step.summary?.(data) ?? null).filter((line): line is string => Boolean(line));
  const note = await flow.reviewNote?.(data, draft);
  const body = `Please check your ${flow.what}:\n${lines.map((line) => `• ${line}`).join("\n")}${note ? `\n\n${note}` : ""}\n\nReply confirm to submit, edit to change something, pause to finish later, or cancel.`;
  return { reply: body, interactive: body.length <= 1024 ? reviewButtons(body, draft.revision) : undefined, draftId: draft.id };
}

const editableSteps = <D>(flow: GuidedFlow<D>, data: D) => order(flow, data).filter((step) => step.editable !== false && step.answer);
const editMenu = <D>(flow: GuidedFlow<D>, data: D) => `Which answer do you want to change? Reply with its number:\n${numbered(editableSteps(flow, data).map((step) => step.label))}`;

function nextStep<D>(flow: GuidedFlow<D>, data: D, from: string) {
  const steps = order(flow, data);
  const index = steps.findIndex((step) => step.id === from);
  return steps[index + 1]?.id ?? "review";
}

/**
 * Advances a guided flow by one message. Every change goes through `applyFlowDraftChange`, so a
 * redelivered message changes nothing and the reply repeats the current question.
 */
export async function advanceGuided<D>(flow: GuidedFlow<D>, draft: FlowDraft, input: FlowInput): Promise<FlowResult> {
  const body = input.body;
  const said = command(body);
  const data = flow.read(draft.data);
  const meta = metaOf(draft.data);

  const save = async (step: string, next: D, reply?: string): Promise<FlowResult> => {
    const result = await applyFlowDraftChange(draft.id, input.userId, input.messageId, () => ({ step, data: next as Record<string, unknown> }));
    if (!result.draft) return { reply: "This draft is no longer open. Reply menu to start again.", exit: true };
    if (result.replayed) return promptFor(flow, result.draft);
    const prompt = await promptFor(flow, result.draft);
    return reply ? { ...prompt, reply: `${reply}\n\n${prompt.reply}`, interactive: prompt.interactive && `${reply}\n\n${prompt.reply}`.length <= 1024 ? { ...prompt.interactive, body: `${reply}\n\n${prompt.interactive.body}` } : prompt.interactive } : prompt;
  };

  if (draft.step === "submitting") return promptFor(flow, draft);

  if (draft.step === "cancel_confirm") {
    if (/^(yes|discard|yes, discard)$/.test(said)) {
      await cancelFlowDraft(draft.id, input.userId);
      return { reply: `Your ${flow.what} draft is discarded. Nothing was submitted. Reply menu to see what else I can do.`, exit: true };
    }
    return save(meta.previousStep ?? "review", data, said === "no" || said === "keep going" ? "Okay, keeping your draft." : undefined);
  }

  if (input.kind === "text") {
    if (CONTROL.help.test(said)) return { ...(await promptFor(flow, draft)), reply: `${HELP}\n\n${(await promptFor(flow, draft)).reply}` };
    if (CONTROL.pause.test(said)) return { reply: `Saved. Your ${flow.what} draft is kept for 14 days. Reply resume to continue where you left off.`, exit: true };
    if (CONTROL.cancel.test(said)) return save("cancel_confirm", withMeta(data, { ...meta, previousStep: draft.step }));
    if (CONTROL.review.test(said) && meta.returnToReview) return moveTo(flow, draft, input, data, "review", save);
    const edit = said.match(CONTROL.edit);
    if (edit) {
      const choices = editableSteps(flow, data);
      if (edit[1]) {
        const target = choices[Number(edit[1]) - 1];
        if (!target) return save("edit_pick", data);
        return save(target.id, withMeta(data, { ...meta, returnToReview: true }));
      }
      return save("edit_pick", data);
    }
    if (CONTROL.back.test(said)) {
      const steps = order(flow, data);
      const index = steps.findIndex((step) => step.id === draft.step);
      const previous = draft.step === "review" ? steps[steps.length - 1] : steps[index - 1];
      return previous ? save(previous.id, withMeta(data, { ...meta, returnToReview: false })) : promptFor(flow, draft);
    }
  }

  if (draft.step === "edit_pick") {
    const choices = editableSteps(flow, data);
    const pick = /^\d{1,2}$/.test(said) ? choices[Number(said) - 1] : undefined;
    if (!pick) return { reply: editMenu(flow, data), draftId: draft.id };
    return save(pick.id, withMeta(data, { ...meta, returnToReview: true }));
  }

  if (draft.step === "review") {
    const confirm = input.kind === "text" ? readConfirm(body) : null;
    if (!confirm) return { ...(await reviewPrompt(flow, draft)), reply: `Please reply confirm, edit or cancel.\n\n${(await reviewPrompt(flow, draft)).reply}` };
    return flow.submit(draft, input, confirm.revision ?? draft.revision);
  }

  const step = flow.steps.find((item) => item.id === draft.step);
  if (!step) return save(order(flow, data)[0]?.id ?? "review", data);

  if (input.media) {
    if (!step.media) return { reply: `I wasn't expecting a photo at this step, so I didn't save it.\n\n${(await step.prompt(data)).text}`, draftId: draft.id };
    // Media changes are applied once per message too: the draft records the message id.
    let outcome: { data: D; reply: string; advance?: boolean } | null = null;
    const result = await applyFlowDraftChange(draft.id, input.userId, input.messageId, async (locked) => {
      outcome = await step.media!(input.media!.id, flow.read(locked.data), input, locked);
      return { step: outcome.advance ? (meta.returnToReview ? "review" : nextStep(flow, outcome.data, step.id)) : step.id, data: outcome.data as Record<string, unknown> };
    });
    if (!result.draft) return { reply: "This draft is no longer open. Reply menu to start again.", exit: true };
    if (result.replayed || !outcome) return promptFor(flow, result.draft);
    const settled = outcome as { data: D; reply: string; advance?: boolean };
    if (!settled.advance) return { reply: settled.reply, draftId: draft.id };
    const prompt = await promptFor(flow, result.draft);
    return { ...prompt, reply: `${settled.reply}\n\n${prompt.reply}` };
  }

  if (!step.answer) {
    const prompt = await step.prompt(data);
    return { reply: prompt.text, interactive: prompt.interactive, draftId: draft.id };
  }
  const answered = await step.answer(body, data, input);
  if ("error" in answered) {
    const prompt = await step.prompt(data);
    return { reply: `${answered.error}\n\n${prompt.text}`, interactive: prompt.interactive, draftId: draft.id };
  }
  if (answered.stay) return save(step.id, withMeta(answered.data, meta), answered.stay);
  return moveTo(flow, draft, input, withMeta(answered.data, meta), meta.returnToReview ? "review" : nextStep(flow, answered.data, step.id), save);
}

/** Moves to `target`, running its `enter` hook first. */
async function moveTo<D>(flow: GuidedFlow<D>, draft: FlowDraft, input: FlowInput, data: D, target: string, save: (step: string, data: D, reply?: string) => Promise<FlowResult>): Promise<FlowResult> {
  if (target === "review" && flow.onReview) {
    const reviewed = await flow.onReview(data, draft, input);
    if ("error" in reviewed) return { reply: reviewed.error, draftId: draft.id };
    data = reviewed.data;
  }
  const step = flow.steps.find((item) => item.id === target);
  if (step?.enter) {
    const entered = await step.enter(data, draft, input);
    if ("error" in entered) return { reply: entered.error, draftId: draft.id };
    data = entered.data;
  }
  // Once the review has been reached, answers return to it instead of walking every question.
  if (target === "review") data = withMeta(data, { ...metaOf(data as Record<string, unknown>), returnToReview: true });
  return save(target, data);
}
