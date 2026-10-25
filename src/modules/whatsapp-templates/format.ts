import { createHash } from "node:crypto";
import { safeTemplateText } from "@/modules/whatsapp-assistant/outbound";
import { metaTemplateName, type UtilityTemplate } from "./registry";

/**
 * Meta's template rules that are checked before anything is submitted. `errors` block submission;
 * `flags` are compliance concerns a person must look at (Meta may reject the template or move it
 * to the Marketing category).
 */
export function validateUtilityTemplate(template: UtilityTemplate) {
  const errors: string[] = [];
  const flags: string[] = [];
  const name = metaTemplateName(template);
  if (!/^[a-z0-9_]{1,512}$/.test(name)) errors.push("Name must be lowercase letters, digits and underscores.");
  if (template.category !== "UTILITY") errors.push("Category must be UTILITY.");
  if (template.language !== "en") errors.push("Language must be en.");

  const placeholders = [...template.body.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)].map((match) => match[1]);
  const numbers = placeholders.map(Number);
  if (placeholders.some((value) => !/^\d+$/.test(value))) errors.push("Placeholders must be numbered, like {{1}}.");
  else if (numbers.some((value, index) => value !== index + 1)) errors.push("Placeholders must run {{1}}, {{2}}, ... in order, each used once.");
  if (placeholders.length !== template.params.length) errors.push(`Body has ${placeholders.length} placeholders but ${template.params.length} parameters are mapped.`);
  if (/^\s*\{\{/.test(template.body)) errors.push("Body must not start with a placeholder.");
  if (/\{\{\d+\}\}[\s.!?,:;]*$/.test(template.body)) errors.push("Body must not end with a placeholder.");
  if (/\}\}\s*\{\{/.test(template.body)) errors.push("Placeholders must not be next to each other.");
  if (template.body.length > 1024) errors.push("Body is longer than 1024 characters.");
  const rendered = template.body.length + template.params.reduce((sum, param) => sum + param.max, 0);
  if (rendered > 1024) errors.push(`Body can reach ${rendered} characters with the longest parameters (limit 1024).`);
  const words = template.body.replace(/\{\{\d+\}\}/g, " ").split(/\s+/).filter(Boolean).length;
  if (words < template.params.length * 3 + 3) errors.push("Too many parameters for the length of the message (Meta rejects these).");
  if (/[\t]| {5,}|\n{3,}/.test(template.body)) errors.push("Body contains tabs, long runs of spaces or more than two newlines.");
  for (const param of template.params) {
    if (!/^[a-z][a-z0-9_]*$/.test(param.name)) errors.push(`Parameter name ${param.name} is not snake_case.`);
    if (!param.sample.trim()) errors.push(`Parameter ${param.name} has no sample.`);
    if (param.sample.length > param.max) errors.push(`Sample for ${param.name} is longer than its limit.`);
    if (/[\n\t]| {5,}/.test(param.sample)) errors.push(`Sample for ${param.name} contains newlines or tabs.`);
    if (/^(test|sample|example|xxx|abc|string|value|\d+)$/i.test(param.sample.trim())) flags.push(`Sample for ${param.name} is not realistic.`);
  }
  if (new Set(template.params.map(({ name: paramName }) => paramName)).size !== template.params.length) errors.push("Parameter names must be unique.");
  for (const button of template.buttons ?? []) {
    if (button.text.length > 25) errors.push(`Button "${button.text}" is longer than 25 characters.`);
  }
  if ((template.buttons?.length ?? 0) > 3) errors.push("At most three quick replies.");

  // Utility means a specific transaction or account event the recipient is party to.
  const promotional = /\b(offer|offers|discount|deal|deals|sale|promo|promotion|free|win|winner|prize|bonus|limited time|exclusive|buy now|book now|shop|subscribe|upgrade|special|save \d+|% off|hurry|don't miss|new arrivals?|recommended for you)\b/i;
  const hit = template.body.match(promotional);
  if (hit) flags.push(`Body contains promotional wording ("${hit[0]}").`);
  if (/https?:\/\//i.test(template.body)) flags.push("Body contains a link; Utility links must point to the specific transaction.");
  if (/[\u{1F300}-\u{1FAFF}]/u.test(template.body)) flags.push("Body contains emoji.");
  if (template.reviewFlag) flags.push(template.reviewFlag);
  if (template.content === "DRAFT") flags.push("Body is a draft, not the approved catalogue text.");
  if (template.content === "NEEDS_REVIEW") flags.push("Catalogue text that failed a check; it is not submitted until the catalogue changes.");
  return { errors, flags };
}

/** The components submitted to Meta for this template, with sample values. */
export function templateCreationPayload(template: UtilityTemplate) {
  return {
    name: metaTemplateName(template),
    language: template.language,
    category: template.category,
    // Meta must not silently move a Utility template to Marketing: the request is rejected instead.
    allow_category_change: false,
    components: [
      {
        type: "BODY",
        text: template.body,
        ...(template.params.length ? { example: { body_text: [template.params.map(({ sample }) => sample)] } } : {}),
      },
      ...(template.buttons?.length ? [{ type: "BUTTONS", buttons: template.buttons.map(({ type, text }) => ({ type, text })) }] : []),
    ],
  };
}

const contentHash = (name: string, language: string, body: string, buttons: string[]) =>
  createHash("sha256").update(JSON.stringify({ name, language, body, buttons })).digest("hex");

/** Identifies exactly what is approved: a registry edit after approval changes the hash. */
export function templateContentHash(template: UtilityTemplate) {
  return contentHash(metaTemplateName(template), template.language, template.body, (template.buttons ?? []).map(({ type, text }) => `${type}:${text}`));
}

/** The same hash for a template as Meta returns it, so a template created in WhatsApp Manager matches too. */
export function metaContentHash(remote: { name: string; language: string; components?: Array<{ type?: string; text?: string; buttons?: Array<{ type?: string; text?: string }> }> }) {
  const body = remote.components?.find(({ type }) => type === "BODY")?.text ?? "";
  const buttons = remote.components?.find(({ type }) => type === "BUTTONS")?.buttons?.map(({ type, text }) => `${type}:${text}`) ?? [];
  return contentHash(remote.name, remote.language, body, buttons);
}

/**
 * Parameter values in placeholder order. Values typed by users are stripped of links and phone
 * numbers; every value loses newlines and tabs (Meta rejects them) and is capped at its limit.
 */
export function templateParameters(template: UtilityTemplate, values: Record<string, string>) {
  const missing = template.params.filter(({ name }) => !values[name]?.trim()).map(({ name }) => name);
  if (missing.length) throw new Error(`Template ${template.key} is missing ${missing.join(", ")}.`);
  // An event supplies every value it has; a template uses only the ones it declares.
  return template.params.map((param) => {
    const flat = values[param.name].replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
    return param.source === "customer" ? safeTemplateText(flat, param.max) : flat.slice(0, param.max);
  });
}

/** The message as the recipient reads it, for the conversation transcript. */
export function renderTemplate(template: UtilityTemplate, parameters: string[]) {
  return template.body.replace(/\{\{(\d+)\}\}/g, (_, index: string) => parameters[Number(index) - 1] ?? "");
}
