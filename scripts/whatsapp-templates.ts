/**
 * WhatsApp Utility templates (U01-U30): validation, Meta payloads, status sync and submission.
 *
 *   npm run whatsapp:templates -- validate              Meta format and compliance checks (offline)
 *   npm run whatsapp:templates -- payloads [file]       Creation payloads as JSON (offline)
 *   npm run whatsapp:templates -- report                Registry joined with stored Meta status
 *   npm run whatsapp:templates -- sync                  Read every template's status from Meta
 *   npm run whatsapp:templates -- submit --keys U01,U02 --confirm-waba <WABA id> [--acknowledge U17]
 *
 * `sync` and `submit` act on the official NesAfric number's WABA only, and need
 * WHATSAPP_TEMPLATE_WABA_ID to name the same WABA. `submit` also needs
 * WHATSAPP_TEMPLATE_SUBMISSION_ENABLED=true and the WABA typed again with --confirm-waba. It never
 * resubmits a rejected template or overwrites one that is already on Meta.
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { templateCreationPayload, validateUtilityTemplate } from "@/modules/whatsapp-templates/format";
import { UTILITY_TEMPLATES } from "@/modules/whatsapp-templates/registry";
import { submitTemplates, syncTemplateStatuses, templateStatusReport } from "@/modules/whatsapp-templates/state";
import { db } from "@/platform/database/client";

const [command, ...rest] = process.argv.slice(2);
const option = (name: string) => {
  const index = rest.indexOf(`--${name}`);
  return index >= 0 ? rest[index + 1] : undefined;
};
const list = (value: string | undefined) => (value ? value.split(",").map((item) => item.trim().toUpperCase()).filter(Boolean) : []);

async function main() {
  if (command === "validate") {
    let invalid = 0;
    for (const template of UTILITY_TEMPLATES) {
      const { errors, flags } = validateUtilityTemplate(template);
      if (errors.length) invalid += 1;
      console.log(`${template.key} ${template.name} ${errors.length ? "INVALID" : "ok"}${[...errors, ...flags].map((item) => `\n    - ${item}`).join("")}`);
    }
    process.exitCode = invalid ? 1 : 0;
    return;
  }
  if (command === "payloads") {
    // Only FINAL templates that pass validation are submittable; the rest are listed with their reasons.
    const eligible = UTILITY_TEMPLATES.filter((template) => template.content === "FINAL" && !validateUtilityTemplate(template).errors.length);
    const output = JSON.stringify({
      note: "POST each payload to https://graph.facebook.com/<version>/<NesAfric WABA ID>/message_templates. The WABA is the official NesAfric assignment's; never Tap & Order's. Not submitted.",
      eligible: eligible.map((template) => ({ key: template.key, payload: templateCreationPayload(template) })),
      needsReview: UTILITY_TEMPLATES.filter((template) => !eligible.includes(template)).map((template) => ({ key: template.key, name: template.name, content: template.content, errors: validateUtilityTemplate(template).errors, payload: templateCreationPayload(template) })),
    }, null, 2);
    if (rest[0]) writeFileSync(rest[0], `${output}\n`); else console.log(output);
    return;
  }
  if (command === "report") {
    console.table((await templateStatusReport()).map(({ key, metaName, wiring, content, status, metaCategory, lastSyncedAt }) => ({ key, metaName, wiring, content, status, metaCategory, lastSyncedAt: lastSyncedAt?.toISOString() ?? "never" })));
    return;
  }
  if (command === "sync") {
    const result = await syncTemplateStatuses();
    console.table(result.states.map(({ templateKey, metaName, status, metaCategory, rejectedReason }) => ({ templateKey, metaName, status, metaCategory, rejectedReason })));
    if (result.unmanaged.length) { console.log("Templates on this WABA outside the registry (not changed):"); console.table(result.unmanaged); }
    return;
  }
  if (command === "submit") {
    const keys = list(option("keys"));
    const confirmWabaId = option("confirm-waba");
    if (!keys.length || !confirmWabaId) throw new Error("Usage: submit --keys U01,U02 --confirm-waba <WABA id> [--acknowledge U17]");
    const result = await submitTemplates({ keys, confirmWabaId, acknowledgeFlags: list(option("acknowledge")) });
    console.table(result.outcomes);
    return;
  }
  throw new Error("Commands: validate | payloads [file] | report | sync | submit");
}

main()
  .catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; })
  .finally(() => db.$disconnect());
