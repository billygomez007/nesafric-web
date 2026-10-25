import { handleFlowsRequest } from "@/modules/whatsapp-flows/endpoint";

/**
 * WhatsApp Flows data-exchange endpoint (set as each Flow's endpoint URI in Meta):
 * https://www.nesafric.com/api/webhooks/whatsapp/flows. Requests are signed with the Meta app
 * secret and encrypted to NesAfric's Flows key; see src/modules/whatsapp-flows/endpoint.ts.
 */
export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > 256_000) return new Response(JSON.stringify({ error: "Request too large." }), { status: 413, headers: { "content-type": "application/json" } });
  const result = await handleFlowsRequest(raw, request.headers.get("x-hub-signature-256"));
  return new Response(result.body, { status: result.status, headers: { "content-type": result.contentType, "cache-control": "no-store" } });
}
