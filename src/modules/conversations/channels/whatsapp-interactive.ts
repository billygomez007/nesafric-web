import { z } from "zod";

/**
 * WhatsApp Cloud API interactive session messages: a list (up to 10 rows) or reply buttons (up to
 * 3). They are free-form replies, so they obey the 24-hour customer-service window like text; they
 * are never a substitute for an approved template. Each row or button id is the exact text the
 * deterministic assistant already understands: the inbound parser turns a tap into a message whose
 * body is that id. The message body stored with the reply is the plain-text fallback, so the
 * transcript and staff inbox read the same whether or not the person's app showed the options.
 */
const id = z.string().trim().min(1).max(200);
const body = z.string().trim().min(1).max(1024);

export const whatsappInteractiveSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("list"),
    body,
    footer: z.string().trim().min(1).max(60).optional(),
    /** The label of the button that opens the list. */
    button: z.string().trim().min(1).max(20),
    sections: z.array(z.object({
      title: z.string().trim().min(1).max(24).optional(),
      rows: z.array(z.object({ id, title: z.string().trim().min(1).max(24), description: z.string().trim().min(1).max(72).optional() })).min(1),
    })).min(1).max(10)
      .refine((sections) => sections.reduce((count, section) => count + section.rows.length, 0) <= 10, "A WhatsApp list has at most 10 rows.")
      .refine((sections) => sections.length === 1 || sections.every((section) => section.title), "Every section of a multi-section list needs a title."),
  }),
  z.object({
    type: z.literal("button"),
    body,
    footer: z.string().trim().min(1).max(60).optional(),
    buttons: z.array(z.object({ id, title: z.string().trim().min(1).max(20) })).min(1).max(3),
  }),
  /** A WhatsApp Flow (`src/modules/whatsapp-flows`). `token` is the server-signed flow_token. */
  z.object({
    type: z.literal("flow"),
    body,
    footer: z.string().trim().min(1).max(60).optional(),
    flowId: z.string().regex(/^\d{1,30}$/),
    token: z.string().min(1).max(1024),
    cta: z.string().trim().min(1).max(30),
    screen: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/).optional(),
    /** Draft Flows can be sent for testing before they are published. */
    mode: z.enum(["draft", "published"]).default("published"),
  }),
]).superRefine((value, context) => {
  if (value.type === "flow") return;
  const ids = value.type === "list" ? value.sections.flatMap((section) => section.rows.map((row) => row.id)) : value.buttons.map((button) => button.id);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", message: "Interactive option ids must be unique." });
});

export type WhatsAppInteractive = z.infer<typeof whatsappInteractiveSchema>;

/** A valid interactive payload, or undefined (the reply then goes out as plain text). */
export function parseWhatsAppInteractive(value: unknown): WhatsAppInteractive | undefined {
  const parsed = whatsappInteractiveSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** Reply buttons for a short prompt. Undefined when the prompt is too long to be a button message. */
export function replyButtons(text: string, buttons: Array<{ id: string; title: string }>): WhatsAppInteractive | undefined {
  return parseWhatsAppInteractive({ type: "button", body: text, buttons });
}

/** The `interactive` object of a Graph API `/messages` request. */
export function graphInteractive(interactive: WhatsAppInteractive) {
  const footer = interactive.footer ? { footer: { text: interactive.footer } } : {};
  if (interactive.type === "flow") {
    // data_exchange: the first screen comes from the endpoint (INIT), so every screen is server-built.
    return {
      type: "flow",
      body: { text: interactive.body },
      ...footer,
      action: {
        name: "flow",
        parameters: {
          flow_message_version: "3",
          flow_id: interactive.flowId,
          flow_token: interactive.token,
          flow_cta: interactive.cta,
          flow_action: "data_exchange",
          ...(interactive.mode === "draft" ? { mode: "draft" } : {}),
        },
      },
    };
  }
  if (interactive.type === "list") {
    return {
      type: "list",
      body: { text: interactive.body },
      ...footer,
      action: {
        button: interactive.button,
        sections: interactive.sections.map((section) => ({
          ...(section.title ? { title: section.title } : {}),
          rows: section.rows.map((row) => ({ id: row.id, title: row.title, ...(row.description ? { description: row.description } : {}) })),
        })),
      },
    };
  }
  return {
    type: "button",
    body: { text: interactive.body },
    ...footer,
    action: { buttons: interactive.buttons.map((button) => ({ type: "reply", reply: { id: button.id, title: button.title } })) },
  };
}
