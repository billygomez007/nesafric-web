import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FLOW_DEFINITIONS } from "@/modules/whatsapp-flows/definitions";
import { FLOW_KEYS, flowIds } from "@/modules/whatsapp-flows/registry";
import { issueFlowToken, signOutcome, verifyFlowToken, verifyOutcome } from "@/modules/whatsapp-flows/token";
import { handleFlowsRequest } from "@/modules/whatsapp-flows/endpoint";
import { flowMessage } from "@/modules/whatsapp-flows/messages";
import { graphInteractive } from "@/modules/conversations/channels/whatsapp-interactive";
import { parseWhatsAppEvents } from "@/modules/conversations/channels/whatsapp-payload";
import { flowsClient, flowsKeyPair } from "./helpers/whatsapp-flows";

process.env.SESSION_SECRET ??= "unit-test-session-secret-0123456789abcdef";
const ORG = randomUUID();
const keys = flowsKeyPair();
const env = { WHATSAPP_APP_SECRET: "flows-app-secret", WHATSAPP_FLOWS_PRIVATE_KEY: keys.privateKey, WHATSAPP_OFFICIAL_ORGANISATION_ID: ORG };

type Json = Record<string, unknown>;
const walk = (node: unknown, visit: (node: Json) => void) => { if (Array.isArray(node)) node.forEach((item) => walk(item, visit)); else if (node && typeof node === "object") { visit(node as Json); Object.values(node).forEach((value) => walk(value, visit)); } };

describe("WhatsApp Flow JSON definitions", () => {
  it.each(FLOW_KEYS.map((key) => [key] as const))("%s is structurally valid", (key) => {
    const flow = FLOW_DEFINITIONS[key]() as { version: string; data_api_version: string; routing_model: Record<string, string[]>; screens: Array<{ id: string; terminal?: boolean; data?: Record<string, Json>; layout: { children: Json[] } }> };
    expect(flow.data_api_version).toBe("3.0");
    const ids = flow.screens.map((screen) => screen.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^[A-Z][A-Z_]*$/.test(id) && id !== "SUCCESS")).toBe(true);
    expect(Object.keys(flow.routing_model).sort()).toEqual([...ids].sort());
    expect(Object.values(flow.routing_model).flat().every((target) => ids.includes(target))).toBe(true);
    expect(flow.screens.some((screen) => screen.terminal)).toBe(true);
    // Meta: only forward routes (no route back to a screen that leads here) and every screen connected.
    const reachable = new Set([ids[0]]);
    for (let changed = true; changed;) { changed = false; for (const [from, to] of Object.entries(flow.routing_model)) if (reachable.has(from)) for (const target of to) if (!reachable.has(target)) { reachable.add(target); changed = true; } }
    expect([...reachable].sort(), "every screen is reachable from the first").toEqual([...ids].sort());
    const leadsTo = (from: string, target: string, seen = new Set<string>()): boolean => (flow.routing_model[from] ?? []).some((next) => next === target || (!seen.has(next) && (seen.add(next), leadsTo(next, target, seen))));
    for (const [from, to] of Object.entries(flow.routing_model)) for (const target of to) expect(leadsTo(target, from), `backward route ${target} -> ${from}`).toBe(false);
    for (const screen of flow.screens) {
      const children = screen.layout.children;
      const names = children.filter((child) => typeof child.name === "string").map((child) => child.name as string);
      expect(new Set(names).size).toBe(names.length);
      expect(children.filter((child) => child.type === "Footer")).toHaveLength(1);
      walk(children, (node) => {
        for (const value of Object.values(node)) {
          if (typeof value !== "string") continue;
          for (const [, kind, name] of value.matchAll(/\$\{(data|form)\.([a-z_]+)\}/g)) {
            if (kind === "data") expect(screen.data, `${screen.id} uses data.${name}`).toHaveProperty(name);
            else expect(names, `${screen.id} uses form.${name}`).toContain(name);
          }
        }
        if (["Dropdown", "RadioButtonsGroup", "CheckboxGroup"].includes(node.type as string) && typeof node["data-source"] === "string") {
          const ref = (node["data-source"] as string).match(/^\$\{data\.([a-z_]+)\}$/)?.[1];
          expect(ref && screen.data?.[ref]?.type, `${screen.id} ${String(node.name)}`).toBe("array");
        }
      });
      if (screen.terminal) expect((children.find((child) => child.type === "Footer")!["on-click-action"] as Json).name).toBe("complete");
    }
  });

  it("reads Flow ids from WHATSAPP_FLOW_IDS and ignores anything else", () => {
    expect(flowIds({ WHATSAPP_FLOW_IDS: JSON.stringify({ nesafric_property_search: "1656146049308321", unknown_flow: "1", nesafric_book_viewing: "not-a-number" }) })).toEqual({ nesafric_property_search: "1656146049308321" });
    expect(flowIds({ WHATSAPP_FLOW_IDS: "not json" })).toEqual({});
  });
});

describe("WhatsApp Flow tokens", () => {
  it("binds the Flow, number, organisation and context, and refuses tampering and expiry", () => {
    const token = issueFlowToken({ flow: "nesafric_book_viewing", address: "233241234567", organisationId: ORG, listingId: randomUUID() });
    expect(verifyFlowToken(token)).toMatchObject({ f: "nesafric_book_viewing", a: "+233241234567", o: ORG });
    const [version, payload, signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), a: "+233200000000" })).toString("base64url");
    expect(verifyFlowToken(`${version}.${forged}.${signature}`)).toBeNull();
    expect(verifyFlowToken(token, new Date(Date.now() + 25 * 60 * 60_000))).toBeNull();
    expect(verifyFlowToken("nf1.abc")).toBeNull();
  });

  it("signs Flow outcomes so the chat acts only on NesAfric's own", () => {
    const token = issueFlowToken({ flow: "nesafric_help_support", address: "+233241234567", organisationId: ORG });
    const receipt = signOutcome(token, { outcome: "support", topic: "OTHER" });
    expect(verifyOutcome(token, { topic: "OTHER", outcome: "support" }, receipt)).toBe(true);
    expect(verifyOutcome(token, { outcome: "support", topic: "PAYMENT" }, receipt)).toBe(false);
  });
});

describe("WhatsApp Flows endpoint", () => {
  const client = flowsClient(keys.publicKey, env.WHATSAPP_APP_SECRET);

  it("answers Meta's health check encrypted", async () => {
    const request = client.request({ version: "3.0", action: "ping" });
    const result = await handleFlowsRequest(request.raw, request.signature, env);
    expect([result.status, result.contentType]).toEqual([200, "text/plain"]);
    expect(request.decrypt(result.body)).toEqual({ data: { status: "active" } });
  });

  it("refuses a bad signature (432), an undecryptable body (421) and a foreign token (427)", async () => {
    const request = client.request({ version: "3.0", action: "ping" });
    expect((await handleFlowsRequest(request.raw, "sha256=00", env)).status).toBe(432);
    const other = flowsClient(flowsKeyPair().publicKey, env.WHATSAPP_APP_SECRET).request({ action: "ping" });
    expect((await handleFlowsRequest(other.raw, other.signature, env)).status).toBe(421);
    const foreign = client.request({ version: "3.0", action: "INIT", flow_token: issueFlowToken({ flow: "nesafric_help_support", address: "+233241234567", organisationId: randomUUID() }) });
    expect((await handleFlowsRequest(foreign.raw, foreign.signature, env)).status).toBe(427);
    const forged = client.request({ version: "3.0", action: "INIT", flow_token: "nf1.e30.forged" });
    expect((await handleFlowsRequest(forged.raw, forged.signature, env)).status).toBe(427);
  });

  it("is not available until the Flows key is configured", async () => {
    const request = client.request({ action: "ping" });
    expect((await handleFlowsRequest(request.raw, request.signature, { ...env, WHATSAPP_FLOWS_PRIVATE_KEY: "" })).status).toBe(503);
  });
});

describe("WhatsApp Flow messages", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("sends a configured Flow as a data_exchange message, and nothing for an unconfigured one", () => {
    const flowEnv = { WHATSAPP_FLOW_IDS: JSON.stringify({ nesafric_property_search: "1656146049308321" }) };
    expect(flowMessage("nesafric_help_support", { address: "+233241234567", organisationId: ORG }, flowEnv)).toBeUndefined();
    const message = flowMessage("nesafric_property_search", { address: "+233241234567", organisationId: ORG }, flowEnv)!;
    expect(graphInteractive(message)).toMatchObject({ type: "flow", action: { name: "flow", parameters: { flow_id: "1656146049308321", flow_action: "data_exchange", mode: "draft", flow_message_version: "3" } } });
    expect(verifyFlowToken((graphInteractive(message) as { action: { parameters: { flow_token: string } } }).action.parameters.flow_token)).toMatchObject({ f: "nesafric_property_search" });
  });

  it("reads a finished Flow (nfm_reply) as a flow message carrying its response", () => {
    const envelope = { object: "whatsapp_business_account", entry: [{ id: "1", changes: [{ field: "messages", value: { metadata: { phone_number_id: "999" }, messages: [{ from: "233241234567", id: "wamid.flow1", timestamp: "1792950000", type: "interactive", interactive: { type: "nfm_reply", nfm_reply: { name: "flow", body: "Sent", response_json: "{\"flow_token\":\"nf1.x.y\"}" } } }] } }] }] };
    const parsed = parseWhatsAppEvents(envelope, "999");
    expect(parsed.messages[0]).toMatchObject({ body: "[Form submitted]", providerPayload: { kind: "flow", flowResponse: "{\"flow_token\":\"nf1.x.y\"}" } });
  });
});
