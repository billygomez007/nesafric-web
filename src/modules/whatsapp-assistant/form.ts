import type { Ctx } from "./context";
import { detectCommand } from "./nlu";
import type { ReplyOption } from "./messages";

/**
 * A guided, resumable form over WhatsApp: asks one field at a time, validates each answer with
 * deterministic parsing, allows "skip" on optional fields, and lets the person jump back to edit
 * any single field from the review summary. Field values live in the workflow's durable `data`.
 */
export type FormData = { answered: string[]; editing?: boolean; [key: string]: unknown };

export type ParseResult = { ok: true } | { ok: false; error: string };

export type FieldSpec<D extends FormData> = {
  key: string;
  label: string;
  optional?: boolean;
  applies?: (data: D) => boolean;
  /** Ask the question. Use `ctx.prompt`/`ctx.ask`; the driver sets the step. */
  ask: (ctx: Ctx, data: D) => void | Promise<void>;
  /** Validate the answer in `ctx` and store it on `data`. */
  parse: (ctx: Ctx, data: D) => ParseResult | Promise<ParseResult>;
  /** Line for the review summary, or null to omit. */
  summary?: (data: D) => string | null;
};

const STEP_PREFIX = "f:";

export const fieldStep = (key: string) => `${STEP_PREFIX}${key}`;
export const fieldKeyFromStep = (step: string | null) => (step?.startsWith(STEP_PREFIX) ? step.slice(STEP_PREFIX.length) : null);

export function activeFields<D extends FormData>(fields: FieldSpec<D>[], data: D) {
  return fields.filter((field) => !field.applies || field.applies(data));
}

/** Asks the next unanswered field. Returns false when every applicable field is answered. */
export async function askNextField<D extends FormData>(ctx: Ctx, fields: FieldSpec<D>[], data: D): Promise<boolean> {
  const next = activeFields(fields, data).find((field) => !data.answered.includes(field.key));
  if (!next) return false;
  ctx.step(fieldStep(next.key));
  await next.ask(ctx, data);
  return true;
}

export async function askField<D extends FormData>(ctx: Ctx, fields: FieldSpec<D>[], data: D, key: string) {
  const field = fields.find((candidate) => candidate.key === key);
  if (!field) return false;
  ctx.step(fieldStep(field.key));
  await field.ask(ctx, data);
  return true;
}

/**
 * Handles an answer for the current field. Returns "next" when the caller should continue
 * (ask the next field or show the summary), or "stay" when the same field was re-asked.
 */
export async function handleFieldAnswer<D extends FormData>(ctx: Ctx, fields: FieldSpec<D>[], data: D): Promise<"next" | "stay"> {
  const key = fieldKeyFromStep(ctx.state.step);
  const field = fields.find((candidate) => candidate.key === key);
  if (!field) return "next";
  if (field.optional && !ctx.choice && !ctx.input.media && detectCommand(ctx.text) === "skip") {
    if (!data.answered.includes(field.key)) data.answered.push(field.key);
    delete data[field.key];
    return "next";
  }
  const result = await field.parse(ctx, data);
  if (!result.ok) {
    ctx.say(result.error);
    await field.ask(ctx, data);
    return "stay";
  }
  if (!data.answered.includes(field.key)) data.answered.push(field.key);
  return "next";
}

export function summaryLines<D extends FormData>(fields: FieldSpec<D>[], data: D) {
  return activeFields(fields, data).map((field) => field.summary?.(data)).filter((line): line is string => Boolean(line));
}

/** Options for "which detail do you want to change?". */
export function editOptions<D extends FormData>(fields: FieldSpec<D>[], data: D, prefix: string): ReplyOption[] {
  return activeFields(fields, data).filter((field) => field.summary).map((field) => ({ id: `${prefix}${field.key}`, title: field.label }));
}

export function beginEdit<D extends FormData>(data: D, key: string) {
  data.answered = data.answered.filter((answered) => answered !== key);
  data.editing = true;
}

/** Appended to optional questions. */
export const SKIP_HINT = "Reply *skip* if you'd rather not say.";
