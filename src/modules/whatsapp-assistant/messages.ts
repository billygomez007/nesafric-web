/**
 * Channel-neutral replies produced by the conversation engine, and their rendering into WhatsApp
 * Cloud API message payloads. Rendering enforces WhatsApp's interactive-message limits (3 reply
 * buttons, 10 list rows, title/description lengths) so a long title can never make a send fail.
 */

export type ReplyOption = { id: string; title: string; description?: string };

export type Reply =
  | { kind: "text"; text: string }
  | { kind: "buttons"; text: string; options: ReplyOption[] }
  | { kind: "list"; text: string; button: string; options: ReplyOption[] }
  | { kind: "image"; url: string; caption?: string }
  | { kind: "template"; name: string; language: string; parameters: string[] };

const BODY_MAX = 1024;
const TEXT_MAX = 4096;
const CAPTION_MAX = 1024;
const BUTTON_TITLE_MAX = 20;
const LIST_BUTTON_MAX = 20;
const ROW_TITLE_MAX = 24;
const ROW_DESCRIPTION_MAX = 72;
const ROW_ID_MAX = 200;

export function truncate(value: string, max: number) {
  const clean = value.trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

export const text = (value: string): Reply => ({ kind: "text", text: value });
export const buttons = (body: string, options: ReplyOption[]): Reply => ({ kind: "buttons", text: body, options });
export const list = (body: string, button: string, options: ReplyOption[]): Reply => ({ kind: "list", text: body, button, options });

/**
 * Picks the right interactive shape for a set of choices: up to 3 → reply buttons, up to 10 → a
 * list, more → a numbered text menu. Options are always also numbered so a person can type "2".
 */
export function choices(body: string, options: ReplyOption[], button = "Choose"): Reply {
  if (options.length <= 3 && options.every(({ title }) => title.length <= BUTTON_TITLE_MAX)) return buttons(body, options);
  if (options.length <= 10) return list(body, button, options);
  return text(`${body}\n\n${options.map((option, index) => `${index + 1}. ${option.title}`).join("\n")}`);
}

export type CloudApiMessage = Record<string, unknown>;

/** Converts a reply into the JSON body for `POST /{phone-number-id}/messages`. */
export function toCloudApiMessage(to: string, reply: Reply): CloudApiMessage {
  const base = { messaging_product: "whatsapp", recipient_type: "individual", to };
  switch (reply.kind) {
    case "text":
      return { ...base, type: "text", text: { body: truncate(reply.text, TEXT_MAX), preview_url: /https?:\/\//.test(reply.text) } };
    case "image":
      return { ...base, type: "image", image: { link: reply.url, ...(reply.caption ? { caption: truncate(reply.caption, CAPTION_MAX) } : {}) } };
    case "buttons":
      return {
        ...base,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: truncate(reply.text, BODY_MAX) },
          action: {
            buttons: reply.options.slice(0, 3).map((option) => ({
              type: "reply",
              reply: { id: option.id.slice(0, ROW_ID_MAX), title: truncate(option.title, BUTTON_TITLE_MAX) },
            })),
          },
        },
      };
    case "list":
      return {
        ...base,
        type: "interactive",
        interactive: {
          type: "list",
          body: { text: truncate(reply.text, BODY_MAX) },
          action: {
            button: truncate(reply.button, LIST_BUTTON_MAX),
            sections: [{
              title: "Options",
              rows: reply.options.slice(0, 10).map((option) => ({
                id: option.id.slice(0, ROW_ID_MAX),
                title: truncate(option.title, ROW_TITLE_MAX),
                ...(option.description ? { description: truncate(option.description, ROW_DESCRIPTION_MAX) } : {}),
              })),
            }],
          },
        },
      };
    case "template":
      return {
        ...base,
        type: "template",
        template: {
          name: reply.name,
          language: { code: reply.language },
          ...(reply.parameters.length
            ? { components: [{ type: "body", parameters: reply.parameters.map((value) => ({ type: "text", text: truncate(value, 1000) })) }] }
            : {}),
        },
      };
  }
}

/** Plain-text rendering of any reply, used for logs/admin views and template fallbacks. */
export function replyAsText(reply: Reply): string {
  switch (reply.kind) {
    case "text":
      return reply.text;
    case "image":
      return reply.caption ?? "[image]";
    case "template":
      return reply.parameters.join(" ");
    default:
      return `${reply.text}\n${reply.options.map((option, index) => `${index + 1}. ${option.title}`).join("\n")}`;
  }
}

/** The choices a reply offered, so a typed number ("2") can be mapped back to an option id. */
export function offeredOptions(reply: Reply): ReplyOption[] {
  return reply.kind === "buttons" || reply.kind === "list" ? reply.options : [];
}
