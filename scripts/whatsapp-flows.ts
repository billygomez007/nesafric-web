/**
 * WhatsApp Flows: export, upload and status. Acts only on the twelve existing Flow ids; it never
 * creates a Flow container and never publishes one.
 *
 *   npx tsx scripts/whatsapp-flows.ts export <dir>                 Write the 12 Flow JSON files (offline)
 *   npx tsx scripts/whatsapp-flows.ts status                       Each Flow's status and validation errors
 *   npx tsx scripts/whatsapp-flows.ts upload --confirm-waba <id>   Upload the JSON to the existing Flow ids
 *   npx tsx scripts/whatsapp-flows.ts endpoint --confirm-waba <id> Point every Flow at the data-exchange endpoint
 *
 * Needs NESAFRIC_META_TOKEN (a system-user token with whatsapp_business_management) and
 * NESAFRIC_WABA_ID; Flow ids come from WHATSAPP_FLOW_IDS or --registry <file> (the
 * nesafric_flow_registry.json kept with the templates).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FLOW_DEFINITIONS } from "@/modules/whatsapp-flows/definitions";
import { FLOW_KEYS, flowIds, type FlowKey } from "@/modules/whatsapp-flows/registry";

const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION ?? "v23.0"}`;
const [command, ...rest] = process.argv.slice(2);
const option = (name: string) => { const index = rest.indexOf(`--${name}`); return index >= 0 ? rest[index + 1] : undefined; };

function ids(): Partial<Record<FlowKey, string>> {
  const registry = option("registry");
  return registry ? flowIds({ WHATSAPP_FLOW_IDS: readFileSync(registry, "utf8") }) : flowIds();
}

function credentials() {
  const token = process.env.NESAFRIC_META_TOKEN;
  const waba = process.env.NESAFRIC_WABA_ID;
  if (!token || !waba) throw new Error("Set NESAFRIC_META_TOKEN and NESAFRIC_WABA_ID.");
  return { token, waba };
}

function confirmWaba(waba: string) {
  if (option("confirm-waba") !== waba) throw new Error(`Type the WABA id again with --confirm-waba ${waba} to change its Flows.`);
}

async function graph(path: string, init: RequestInit = {}) {
  const { token } = credentials();
  const response = await fetch(`${GRAPH}/${path}`, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  return { ok: response.ok, status: response.status, body };
}

/** The Flows of this WABA, so an id that belongs elsewhere is never changed. */
async function wabaFlowIds(waba: string) {
  const found = new Set<string>();
  let path: string | null = `${waba}/flows?fields=id,name&limit=100`;
  while (path) {
    const page = await graph(path);
    if (!page.ok) throw new Error(`Listing Flows failed (${page.status}).`);
    for (const flow of (page.body.data as Array<{ id: string }> | undefined) ?? []) found.add(flow.id);
    const next = (page.body.paging as { next?: string } | undefined)?.next;
    path = next ? next.replace(`${GRAPH}/`, "") : null;
  }
  return found;
}

async function main() {
  if (command === "export") {
    const dir = rest[0] ?? "flows-json";
    mkdirSync(dir, { recursive: true });
    for (const key of FLOW_KEYS) writeFileSync(join(dir, `${key}.json`), `${JSON.stringify(FLOW_DEFINITIONS[key](), null, 2)}\n`);
    console.log(`Wrote ${FLOW_KEYS.length} Flow JSON files to ${dir}.`);
    return;
  }
  const registered = ids();
  const missing = FLOW_KEYS.filter((key) => !registered[key]);
  if (missing.length) throw new Error(`No Flow id for: ${missing.join(", ")}.`);
  const { waba } = credentials();
  if (command === "status") {
    for (const key of FLOW_KEYS) {
      const flow = await graph(`${registered[key]}?fields=id,name,status,json_version,data_api_version,endpoint_uri,validation_errors,health_status`);
      const body = flow.body as { status?: string; json_version?: string; endpoint_uri?: string; validation_errors?: Array<{ error: string; message: string; line_start?: number }> };
      console.log(`${key} ${registered[key]} ${flow.ok ? body.status : `ERROR ${flow.status}`} json=${body.json_version ?? "-"} endpoint=${body.endpoint_uri ?? "-"} errors=${body.validation_errors?.length ?? 0}`);
      for (const error of body.validation_errors ?? []) console.log(`    - ${error.error}: ${error.message}${error.line_start ? ` (line ${error.line_start})` : ""}`);
    }
    return;
  }
  confirmWaba(waba);
  const owned = await wabaFlowIds(waba);
  const foreign = FLOW_KEYS.filter((key) => !owned.has(registered[key]!));
  if (foreign.length) throw new Error(`These Flow ids are not in WABA ${waba}: ${foreign.join(", ")}. Nothing was changed.`);
  if (command === "upload") {
    for (const key of FLOW_KEYS) {
      const form = new FormData();
      form.append("file", new Blob([JSON.stringify(FLOW_DEFINITIONS[key]())], { type: "application/json" }), "flow.json");
      form.append("name", "flow.json");
      form.append("asset_type", "FLOW_JSON");
      const result = await graph(`${registered[key]}/assets`, { method: "POST", body: form });
      const errors = (result.body.validation_errors as Array<{ error: string; message: string; line_start?: number }> | undefined) ?? [];
      console.log(`${key} ${result.ok ? "uploaded" : `FAILED ${result.status} ${JSON.stringify(result.body.error ?? {})}`} validation_errors=${errors.length}`);
      for (const error of errors) console.log(`    - ${error.error}: ${error.message}${error.line_start ? ` (line ${error.line_start})` : ""}`);
    }
    console.log("Uploaded as drafts. Nothing was published.");
    return;
  }
  if (command === "endpoint") {
    const uri = option("uri") ?? "https://www.nesafric.com/api/webhooks/whatsapp/flows";
    for (const key of FLOW_KEYS) {
      const result = await graph(registered[key]!, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint_uri: uri }) });
      console.log(`${key} endpoint ${result.ok ? "set" : `FAILED ${result.status} ${JSON.stringify(result.body.error ?? {})}`}`);
    }
    return;
  }
  throw new Error("Usage: export <dir> | status | upload --confirm-waba <id> | endpoint --confirm-waba <id> [--uri <url>]");
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
