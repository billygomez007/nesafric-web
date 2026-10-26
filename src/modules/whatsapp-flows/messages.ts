import type { WhatsAppInteractive } from "@/modules/conversations/channels/whatsapp-interactive";
import { flowIds, flowMode, type FlowKey } from "./registry";
import { issueFlowToken } from "./token";

/** What each Flow's message says, and its button. */
export const FLOW_COPY: Record<FlowKey, { title: string; body: string; cta: string }> = {
  nesafric_property_search: { title: "Find a property", body: "Search published homes, land and commercial property across Ghana, then book a viewing or ask a question.", cta: "Search properties" },
  nesafric_book_viewing: { title: "Book a viewing", body: "Choose a date and time for your viewing. The agent confirms the appointment with you.", cta: "Book viewing" },
  nesafric_property_inquiry: { title: "Ask about a property", body: "Send your question to the listing team. Your name and number are shared with them only.", cta: "Ask a question" },
  nesafric_list_property: { title: "List a property", body: "Add your property's details in one form. Photos and NesAfric review follow in this chat.", cta: "List property" },
  nesafric_agent_registration: { title: "Register an agency or agent", body: "Register your agency or agent profile. Next you send your certificate or Ghana Card here for verification.", cta: "Register" },
  nesafric_landlord_registration: { title: "Set up your properties", body: "Add your first property and its units. Tenants and more properties follow in this chat.", cta: "Get started" },
  nesafric_tenant_registration: { title: "Connect your tenancy", body: "Enter the tenant access code from your landlord to connect your tenancy.", cta: "Connect tenancy" },
  nesafric_maintenance_request: { title: "Report a problem", body: "Report a repair at your home. It goes to your landlord for that property.", cta: "Report problem" },
  nesafric_find_professional: { title: "Find a professional", body: "Find verified plumbers, electricians and other property professionals near you.", cta: "Find professional" },
  nesafric_book_service: { title: "Book a service", body: "Tell us the job and NesAfric matches you with verified providers.", cta: "Request service" },
  nesafric_property_management: { title: "Manage your properties", body: "See your portfolio and choose what to do next.", cta: "Open" },
  nesafric_help_support: { title: "Help and support", body: "Tell us what you need help with. A member of the NesAfric team replies here.", cta: "Get help" },
};

/**
 * The interactive message that opens a Flow for this number, or undefined when the Flow has no
 * Meta id configured (the chat conversation then handles the request as before).
 */
export function flowMessage(flow: FlowKey, input: { address: string; organisationId: string; listingId?: string }, env: Record<string, string | undefined> = process.env): WhatsAppInteractive | undefined {
  const flowId = flowIds(env)[flow];
  if (!flowId) return undefined;
  return {
    type: "flow", body: FLOW_COPY[flow].body, flowId, cta: FLOW_COPY[flow].cta, mode: flowMode(env),
    token: issueFlowToken({ flow, address: input.address, organisationId: input.organisationId, listingId: input.listingId }),
  };
}

/** Flows offered by the "forms" command (the context-bound ones are sent from their own steps). */
export const MENU_FLOWS: FlowKey[] = [
  "nesafric_property_search", "nesafric_list_property", "nesafric_agent_registration", "nesafric_landlord_registration", "nesafric_tenant_registration",
  "nesafric_maintenance_request", "nesafric_find_professional", "nesafric_book_service", "nesafric_property_management", "nesafric_help_support",
];
