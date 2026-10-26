import { linkedWhatsAppUser } from "@/modules/whatsapp-assistant/identity";
import { officialWhatsAppOrganisationId } from "@/modules/whatsapp-assistant/identity";
import { decryptFlowRequest, encryptFlowResponse, FlowDecryptionError, flowsPrivateKey, validFlowSignature } from "./crypto";
import { FLOW_HANDLERS, flowLog, submissionHash, type FlowResponse } from "./handlers";
import type { FlowKey } from "./registry";
import { verifyFlowToken } from "./token";

export type EndpointResult = { status: number; body: string; contentType: "text/plain" | "application/json" };

/**
 * The step each screen's data_exchange stands for. The published Flows send it as `action` in the
 * payload, but WhatsApp does not pass that key on to the endpoint, so the step is taken from the
 * screen that sent the request. A viewing screen has two: picking a date, and the footer.
 */
const viewingStep = (data: Record<string, unknown>) => ("slot" in data || "name" in data ? "book" : "date");
const SCREEN_STEPS: Partial<Record<FlowKey, Record<string, string | ((data: Record<string, unknown>) => string)>>> = {
  nesafric_property_search: { SEARCH: "search", RESULTS: "select", DETAILS: "next", VIEWING: viewingStep, STAY: "stay", QUESTION: "send" },
  nesafric_book_viewing: { BOOK: viewingStep },
  nesafric_property_inquiry: { INQUIRY: "send" },
  nesafric_list_property: { BASICS: "basics", PRICING: "pricing", AUTHORITY: "save" },
  nesafric_agent_registration: { PROFILE: "save" },
  nesafric_landlord_registration: { SETUP: "save" },
  nesafric_tenant_registration: { CONNECT: "redeem" },
  nesafric_maintenance_request: { REPORT: "report" },
  nesafric_find_professional: { SEARCH: "search", RESULTS: "select" },
  nesafric_book_service: { REQUEST: "request" },
  nesafric_property_management: { MENU: "choose" },
  nesafric_help_support: { HELP: "send" },
};

export function stepFromScreen(flow: FlowKey, screen: unknown, data: Record<string, unknown>): string | undefined {
  const step = typeof screen === "string" ? SCREEN_STEPS[flow]?.[screen] : undefined;
  return typeof step === "function" ? step(data) : step;
}

const json = (status: number, value: unknown): EndpointResult => ({ status, body: JSON.stringify(value), contentType: "application/json" });

/**
 * The WhatsApp Flows data-exchange endpoint. Order of checks: Meta's signature (app secret), then
 * decryption with NesAfric's private key (421 makes the client refresh the key), then the
 * flow_token (427 tells WhatsApp it is no longer valid), then the Flow's own handler. Every
 * response is encrypted. Logs carry the Flow, action and screen, never form contents or numbers.
 */
export async function handleFlowsRequest(rawBody: string, signature: string | null, env: Record<string, string | undefined> = process.env): Promise<EndpointResult> {
  if (!validFlowSignature(rawBody, signature, env.WHATSAPP_APP_SECRET)) return json(432, { error: "Invalid signature." });
  const privateKey = flowsPrivateKey(env);
  if (!privateKey) return json(503, { error: "WhatsApp Flows are not configured." });
  let decrypted;
  try {
    decrypted = decryptFlowRequest(JSON.parse(rawBody), privateKey);
  } catch (error) {
    if (error instanceof FlowDecryptionError || error instanceof SyntaxError) return json(421, { error: "Decryption failed." });
    throw error;
  }
  const { body, aesKey, iv } = decrypted;
  const reply = (value: unknown): EndpointResult => ({ status: 200, body: encryptFlowResponse(value, aesKey, iv), contentType: "text/plain" });
  const action = typeof body.action === "string" ? body.action : "";
  // Health check from Meta: no token, no data.
  if (action === "ping") return reply({ data: { status: "active" } });
  const data = body.data && typeof body.data === "object" && !Array.isArray(body.data) ? body.data as Record<string, unknown> : {};
  // A client-side error report: acknowledge it, and log it without its contents.
  if (data.error) {
    flowLog("whatsapp.flows.client_error", { screen: body.screen, error: String(data.error).slice(0, 80) });
    return reply({ data: { acknowledged: true } });
  }
  const token = typeof body.flow_token === "string" ? body.flow_token : "";
  const claims = verifyFlowToken(token);
  if (!claims || claims.o !== officialWhatsAppOrganisationId(env)) {
    flowLog("whatsapp.flows.token_rejected", { action });
    return json(427, { error: "The flow token is invalid or has expired." });
  }
  const sentStep = typeof data.action === "string";
  if (action === "data_exchange" && !sentStep) {
    const step = stepFromScreen(claims.f, body.screen, data);
    if (step) data.action = step;
  }
  const started = Date.now();
  try {
    const linked = await linkedWhatsAppUser(claims.a);
    const handler = FLOW_HANDLERS[claims.f];
    const response: FlowResponse = await handler({ action, screen: typeof body.screen === "string" ? body.screen : undefined, data, flowToken: token }, { claims, token, linked });
    flowLog("whatsapp.flows.exchange", { flow: claims.f, action, requestAction: typeof data.action === "string" ? data.action : undefined, stepFrom: sentStep ? "payload" : "screen", fromScreen: typeof body.screen === "string" ? body.screen : undefined, fields: Object.keys(data).filter((key) => key !== "action").sort().join(","), screen: response.screen, ms: Date.now() - started, session: submissionHash(claims.n), invalid: "error_message" in response.data });
    return reply({ version: "3.0", ...response });
  } catch (error) {
    flowLog("whatsapp.flows.error", { flow: claims.f, action, session: submissionHash(claims.n), error: error instanceof Error ? error.name : "unknown" });
    // The person sees a retryable message on the current screen; nothing partial is committed (domain writes are transactional and idempotent).
    return reply({ version: "3.0", screen: typeof body.screen === "string" ? body.screen : "DONE", data: { error_message: "Something went wrong on our side. Please try again in a moment." } });
  }
}
