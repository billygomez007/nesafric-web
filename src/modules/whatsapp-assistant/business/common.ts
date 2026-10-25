import { replyButtons, type WhatsAppInteractive } from "@/modules/conversations/channels/whatsapp-interactive";

/** One inbound message, as the business flows see it. `userId` is the verified linked account. */
export type FlowInput = {
  /** E.164 with "+". */
  address: string;
  userId: string;
  messageId: string;
  body: string;
  kind: string;
  media?: { id: string; mimeType?: string };
};

export type FlowResult = {
  reply: string;
  interactive?: WhatsAppInteractive;
  /** The conversation leaves the business flow (draft saved, cancelled or submitted). */
  exit?: boolean;
  /** The draft the conversation is now working on (media is bound to it). */
  draftId?: string;
};

export const command = (body: string) => body.trim().toLowerCase().replace(/\s+/g, " ");
export const isSkip = (body: string) => /^(skip|none|no|-|n\/a)$/.test(command(body));

/** Commands every guided flow understands. Matched exactly, so ordinary text never triggers one. */
export const CONTROL = {
  back: /^(back|previous)$/,
  pause: /^(pause|save|save and exit|exit|later)$/,
  cancel: /^(cancel|discard|delete draft)$/,
  help: /^(help|\?)$/,
  review: /^(review|summary)$/,
  edit: /^edit(?: (\d{1,2}))?$/,
};

export const HELP = "You can reply back to change the previous answer, edit to change any answer, review to see everything, pause to save and finish later (reply resume to continue), or cancel to discard this draft.";

export const numbered = (items: string[]) => items.map((item, index) => `${index + 1}. ${item}`).join("\n");

/** Reads "2" or "2, 5" style choices against a list of options (1-based). Null when any is invalid. */
export function pickNumbers(body: string, count: number, max = count): number[] | null {
  const parts = body.split(/[,\s]+/).map((part) => part.trim()).filter(Boolean);
  if (!parts.length || parts.length > max) return null;
  const picks = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  if (picks.some((pick) => !Number.isInteger(pick) || pick < 1 || pick > count)) return null;
  return [...new Set(picks)].map((pick) => pick - 1);
}

export const buttons = (text: string, options: Array<{ id: string; title: string }>) => replyButtons(text, options);

/** Confirm/edit/cancel buttons. The confirm id names the revision reviewed, so a stale tap fails. */
export const reviewButtons = (text: string, revision: number) => buttons(text, [{ id: `confirm ${revision}`, title: "Confirm" }, { id: "edit", title: "Edit" }, { id: "cancel", title: "Cancel" }]);

/** "confirm" (typed, the revision is the one last shown) or "confirm 12" (a button, names it). */
export function readConfirm(body: string): { confirm: true; revision?: number } | null {
  const match = command(body).match(/^(?:confirm|yes, submit|submit)(?: (\d{1,9}))?$/);
  return match ? { confirm: true, revision: match[1] ? Number(match[1]) : undefined } : null;
}

export const cancelPrompt = (what: string) => ({
  reply: `Discard this ${what}? Nothing you entered will be kept. Reply yes to discard, or no to keep going.`,
  interactive: buttons(`Discard this ${what}? Nothing you entered will be kept.`, [{ id: "yes", title: "Discard" }, { id: "no", title: "Keep going" }]),
});

/** Plain text a person typed, trimmed and length-checked. Never interpreted as an instruction. */
export function text(body: string, min: number, max: number) {
  const value = body.trim().replace(/\s+/g, " ");
  return value.length >= min && value.length <= max ? value : null;
}

/** Multi-line text (descriptions), keeping line breaks. */
export function paragraph(body: string, min: number, max: number) {
  const value = body.trim().replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n");
  return value.length >= min && value.length <= max ? value : null;
}

/** Amounts like "4,500", "GHS 4500" or "1.2m" into integer minor units (pesewas). */
export function amountMinor(body: string): string | null {
  const match = command(body).replace(/(ghs|gh₵|cedis?|₵)/g, "").replace(/,/g, "").trim().match(/^(\d{1,12}(?:\.\d{1,2})?)\s*(k|m|thousand|million)?$/);
  if (!match) return null;
  const units = Number(match[1]) * (match[2] === "m" || match[2] === "million" ? 1_000_000 : match[2] === "k" || match[2] === "thousand" ? 1000 : 1);
  const minor = Math.round(units * 100);
  return Number.isSafeInteger(minor) && minor > 0 ? String(minor) : null;
}

export const formatMinor = (minor: string | number | bigint, currency = "GHS") => `${currency} ${(Number(minor) / 100).toLocaleString("en-GH", { maximumFractionDigits: 2 })}`;

/** Ghana's 16 regions, for location prompts. Typed answers are matched case-insensitively. */
export const GHANA_REGIONS = ["Greater Accra", "Ashanti", "Western", "Western North", "Central", "Eastern", "Volta", "Oti", "Northern", "Savannah", "North East", "Upper East", "Upper West", "Bono", "Bono East", "Ahafo"];

export function region(body: string): string | null {
  const picked = pickNumbers(body, GHANA_REGIONS.length, 1);
  if (picked) return GHANA_REGIONS[picked[0]];
  const value = command(body).replace(/ region$/, "");
  return GHANA_REGIONS.find((name) => name.toLowerCase() === value) ?? null;
}

export const regionPrompt = (subject: string) => `Which region ${subject}? Reply with its number or name:\n${numbered(GHANA_REGIONS)}`;
