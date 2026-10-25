/**
 * The twelve NesAfric WhatsApp Flows. Their Meta Flow ids live in WHATSAPP_FLOW_IDS as JSON
 * (`{"nesafric_property_search":"1656…", …}`), the registry kept in
 * ~/nesafric-whatsapp-templates/flows/nesafric_flow_registry.json. A Flow without an id is never
 * sent; the assistant falls back to the chat conversation.
 */
export const FLOW_KEYS = [
  "nesafric_property_search",
  "nesafric_book_viewing",
  "nesafric_property_inquiry",
  "nesafric_list_property",
  "nesafric_agent_registration",
  "nesafric_landlord_registration",
  "nesafric_tenant_registration",
  "nesafric_maintenance_request",
  "nesafric_find_professional",
  "nesafric_book_service",
  "nesafric_property_management",
  "nesafric_help_support",
] as const;
export type FlowKey = (typeof FLOW_KEYS)[number];

export const isFlowKey = (value: unknown): value is FlowKey => typeof value === "string" && (FLOW_KEYS as readonly string[]).includes(value);

export function flowIds(env: Record<string, string | undefined> = process.env): Partial<Record<FlowKey, string>> {
  try {
    const parsed = JSON.parse(env.WHATSAPP_FLOW_IDS ?? "{}") as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter(([key, id]) => isFlowKey(key) && typeof id === "string" && /^\d{1,30}$/.test(id))) as Partial<Record<FlowKey, string>>;
  } catch {
    return {};
  }
}

/** "draft" until the Flows are published (WHATSAPP_FLOWS_MODE=published). */
export const flowMode = (env: Record<string, string | undefined> = process.env): "draft" | "published" => env.WHATSAPP_FLOWS_MODE === "published" ? "published" : "draft";
