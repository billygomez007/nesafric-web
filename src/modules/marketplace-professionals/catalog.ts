/**
 * The controlled catalog of every marketplace entitlement feature key (Phase 21A item 8),
 * deliberately separate from `src/modules/entitlements/catalog.ts` (PropertyOS management
 * entitlements). A `MarketplacePlan` entitlement or future override can never invent a feature
 * key the rest of the application does not know how to enforce — the exact same discipline as
 * the Phase 20 PropertyOS entitlement catalog, applied to the marketplace's own commercial track.
 */
export type MarketplaceEntitlementKind = "BOOLEAN" | "LIMIT";

export type MarketplaceEntitlementDefinition = {
  key: string;
  kind: MarketplaceEntitlementKind;
  label: string;
  description: string;
  unit?: string;
};

export const MARKETPLACE_ENTITLEMENTS = {
  activeListingsMax: { key: "marketplace.listings.active_max", kind: "LIMIT", label: "Active listings", description: "Non-archived marketplace listings this professional may have published at once.", unit: "listings" },
  teamMembersMax: { key: "marketplace.team.members.max", kind: "LIMIT", label: "Team members", description: "Active members of this marketplace professional profile.", unit: "members" },
  developmentsMax: { key: "marketplace.developments.max", kind: "LIMIT", label: "Developments", description: "Active developments/projects this developer may manage.", unit: "developments" },
  leadManagementEnabled: { key: "marketplace.leads.management_enabled", kind: "BOOLEAN", label: "Lead management", description: "Whether lead status tracking, assignment, and activity history are available." },
  promotedListingsEnabled: { key: "marketplace.listings.promoted_enabled", kind: "BOOLEAN", label: "Promoted listings", description: "Whether listings may be promoted/boosted in marketplace search results." },
  featuredProfileEnabled: { key: "marketplace.profile.featured_enabled", kind: "BOOLEAN", label: "Featured profile", description: "Whether the public profile may be featured in marketplace directories." },
  advancedAnalyticsEnabled: { key: "marketplace.analytics.advanced_enabled", kind: "BOOLEAN", label: "Advanced analytics", description: "Whether marketplace performance analytics beyond basic counts are available." },
  /// Phase 21 item 8/9/20 — capability-based AI entitlement keys, one per AI role/capability.
  /// Gates both whether the role can be assigned to a Marketplace AI employee at all, and whether
  /// specific deterministic tools (inventory search, lead follow-up drafting, ...) may run.
  aiReceptionistTextEnabled: { key: "marketplace.ai_receptionist.text", kind: "BOOLEAN", label: "AI Sales Receptionist (text)", description: "Whether an AI Sales Receptionist employee may be configured." },
  aiReceptionistVoiceEnabled: { key: "marketplace.ai_receptionist.voice", kind: "BOOLEAN", label: "AI Sales Receptionist (voice)", description: "Whether the AI Sales Receptionist may handle inbound phone enquiries." },
  aiSalesAgentEnabled: { key: "marketplace.ai_sales_agent", kind: "BOOLEAN", label: "AI Sales Agent", description: "Whether an AI Sales Agent employee may be configured." },
  aiLeadManagerEnabled: { key: "marketplace.ai_lead_manager", kind: "BOOLEAN", label: "AI Lead Manager", description: "Whether an AI Lead Manager employee may be configured." },
  aiListingAssistantEnabled: { key: "marketplace.ai_listing_assistant", kind: "BOOLEAN", label: "AI Listing Assistant", description: "Whether an AI Listing Assistant employee may be configured." },
  aiInventorySearchEnabled: { key: "marketplace.ai_inventory_search", kind: "BOOLEAN", label: "Live inventory search", description: "Whether conversational inventory search is available to AI Sales roles." },
  aiViewingSchedulerEnabled: { key: "marketplace.ai_viewing_scheduler", kind: "BOOLEAN", label: "AI viewing scheduling", description: "Whether AI Sales roles may schedule viewings on a prospect's behalf." },
  aiOutboundFollowupEnabled: { key: "marketplace.ai_outbound_followup", kind: "BOOLEAN", label: "AI outbound follow-up", description: "Whether the AI Lead Manager may draft outbound follow-up messages for human send." },
  aiOutboundCallsEnabled: { key: "marketplace.ai_outbound_calls", kind: "BOOLEAN", label: "AI outbound calls", description: "Whether AI Sales roles may place outbound calls (viewing confirmation, follow-up) where consent and policy allow." },
  /// Phase 22 item 18 — voice-specific capability keys, beyond the per-role voice keys above.
  voiceCallVolumeMax: { key: "marketplace.voice.call_volume_max", kind: "LIMIT", label: "Voice calls / day", description: "Combined inbound + outbound AI voice calls in a rolling 24-hour window.", unit: "calls" },
  voiceRecordingEnabled: { key: "marketplace.voice.recording_enabled", kind: "BOOLEAN", label: "Call recording", description: "Whether AI voice calls may be recorded and transcribed, subject to jurisdiction consent rules." },
  /// Phase 22B item 14/15 — real-time voice usage/cost metering.
  voiceInboundMinutesMonthlyMax: { key: "marketplace.voice.inbound_minutes_monthly_max", kind: "LIMIT", label: "Inbound voice minutes / month", description: "Inbound AI voice call minutes consumed in the current billing period.", unit: "minutes" },
  voiceOutboundMinutesMonthlyMax: { key: "marketplace.voice.outbound_minutes_monthly_max", kind: "LIMIT", label: "Outbound voice minutes / month", description: "Outbound AI voice call minutes consumed in the current billing period.", unit: "minutes" },
  voiceHumanTransferEnabled: { key: "marketplace.voice.human_transfer_enabled", kind: "BOOLEAN", label: "Live human transfer", description: "Whether an in-progress AI voice call may be bridged live to a human number." },
  /// Phase 22C item 11 — concurrency ceiling, capability-based.
  voiceConcurrentCallsMax: { key: "marketplace.voice.concurrent_calls_max", kind: "LIMIT", label: "Concurrent AI voice calls", description: "AI-handled voice calls (inbound + outbound) that may be simultaneously in progress.", unit: "calls" },
} as const satisfies Record<string, MarketplaceEntitlementDefinition>;

export type MarketplaceEntitlementFeatureKey = (typeof MARKETPLACE_ENTITLEMENTS)[keyof typeof MARKETPLACE_ENTITLEMENTS]["key"];

const BY_KEY = new Map<string, MarketplaceEntitlementDefinition>(
  Object.values(MARKETPLACE_ENTITLEMENTS).map((definition) => [definition.key, definition]),
);

export function getMarketplaceEntitlementDefinition(featureKey: string): MarketplaceEntitlementDefinition | undefined {
  return BY_KEY.get(featureKey);
}

export function listMarketplaceEntitlementDefinitions(): MarketplaceEntitlementDefinition[] {
  return Array.from(BY_KEY.values());
}
