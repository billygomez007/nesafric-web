/**
 * The controlled catalog of every entitlement feature key (item 2). Both `SubscriptionPlan`
 * entitlements and `OrganisationEntitlementOverride`s are validated against this list — a plan
 * or override can never invent a feature key the rest of the application does not know how to
 * enforce. `kind` disambiguates a plain on/off feature (`BOOLEAN`) from a numeric ceiling
 * (`LIMIT`), matching `EntitlementKind` in the Prisma schema.
 */
export type EntitlementKind = "BOOLEAN" | "LIMIT";

export type EntitlementDefinition = {
  key: string;
  kind: EntitlementKind;
  label: string;
  description: string;
  /** Only meaningful for `LIMIT` entitlements: the unit the numeric ceiling is expressed in. */
  unit?: string;
};

export const ENTITLEMENTS = {
  propertiesMax: { key: "properties.max", kind: "LIMIT", label: "Properties", description: "Active properties the organisation may manage.", unit: "properties" },
  unitsMax: { key: "units.max", kind: "LIMIT", label: "Units", description: "Active units across all properties.", unit: "units" },
  teamMembersMax: { key: "team.members.max", kind: "LIMIT", label: "Team members", description: "Active organisation members (seats).", unit: "members" },
  aiEmployeesMax: { key: "ai.employees.max", kind: "LIMIT", label: "AI employees", description: "Configured AI employees.", unit: "employees" },
  aiTokensMonthlyMax: { key: "ai.tokens.monthly_max", kind: "LIMIT", label: "AI tokens / month", description: "AI provider input+output tokens consumed in the current billing period.", unit: "tokens" },
  aiCostMonthlyNanoMax: { key: "ai.cost.monthly_nano_max", kind: "LIMIT", label: "AI spend / month", description: "Estimated AI provider cost (nano-units) consumed in the current billing period.", unit: "nano-units" },
  storageBytesMax: { key: "storage.bytes.max", kind: "LIMIT", label: "Storage", description: "Total bytes stored across uploaded and generated documents.", unit: "bytes" },
  listingsMax: { key: "listings.max", kind: "LIMIT", label: "Published listings", description: "Non-archived marketplace listings.", unit: "listings" },
  documentsMonthlyMax: { key: "documents.monthly_max", kind: "LIMIT", label: "Generated documents / month", description: "New generated documents (receipts, statements, lease agreements) in the current billing period.", unit: "documents" },
  messagesMonthlyMax: { key: "messages.monthly_max", kind: "LIMIT", label: "Channel messages / month", description: "Outbound conversation channel messages sent in the current billing period.", unit: "messages" },
  integrationOperationsMonthlyMax: { key: "integrations.operations.monthly_max", kind: "LIMIT", label: "Integration operations / month", description: "Third-party integration operations recorded in the current billing period.", unit: "operations" },
  integrationsEnabled: { key: "integrations.enabled", kind: "BOOLEAN", label: "Third-party integrations", description: "Whether e-signature, geocoding, calendar sync, and communication-channel integrations may be enabled." },
  automationEnabled: { key: "automation.enabled", kind: "BOOLEAN", label: "AI automation", description: "Whether AI employees may auto-execute actions rather than only recommend or propose." },
  advancedReportingEnabled: { key: "reporting.advanced", kind: "BOOLEAN", label: "Advanced reporting", description: "Whether portfolio-wide exportable financial/operational reporting is available." },
  /// Phase 21 item 8/20 — capability-based AI entitlement keys. Domain code must always check
  /// one of these (via `assertOperational`/`resolveEntitlement`), never a raw plan-name equality.
  aiPropertyManagerEnabled: { key: "propertyos.ai_property_manager", kind: "BOOLEAN", label: "AI Property Manager", description: "Whether an AI Property Manager employee may be configured." },
  aiReceptionistTextEnabled: { key: "propertyos.ai_receptionist.text", kind: "BOOLEAN", label: "AI Receptionist (text)", description: "Whether a text-based AI Receptionist employee may be configured." },
  aiReceptionistVoiceEnabled: { key: "propertyos.ai_receptionist.voice", kind: "BOOLEAN", label: "AI Receptionist (voice)", description: "Whether the AI Receptionist may handle inbound phone calls." },
  maintenanceAiClassificationEnabled: { key: "propertyos.maintenance.ai_classification", kind: "BOOLEAN", label: "AI maintenance classification", description: "Whether AI may classify/triage incoming maintenance reports by category and priority." },
  maintenanceAiDispatchEnabled: { key: "propertyos.maintenance.ai_dispatch", kind: "BOOLEAN", label: "AI maintenance dispatch", description: "Whether AI may propose or execute provider dispatch for maintenance work orders." },
  maintenanceVoiceDispatchEnabled: { key: "propertyos.maintenance.voice_dispatch", kind: "BOOLEAN", label: "Voice provider dispatch", description: "Whether AI may place outbound calls to contact maintenance providers." },
  predictiveMaintenanceEnabled: { key: "propertyos.predictive_maintenance", kind: "BOOLEAN", label: "Predictive maintenance", description: "Whether predictive maintenance signals are available. Readiness only in this phase." },
  portfolioIntelligenceEnabled: { key: "propertyos.portfolio_intelligence", kind: "BOOLEAN", label: "Portfolio intelligence", description: "Whether advanced portfolio-wide AI insights are available. Readiness only in this phase." },
  /// Phase 22 item 18 — voice-specific capability keys, beyond the per-role voice keys above.
  voiceOutboundEnabled: { key: "propertyos.voice.outbound_enabled", kind: "BOOLEAN", label: "Outbound AI voice", description: "Whether AI may place general outbound calls (lease reminders, viewing/access coordination, move-in/move-out) beyond maintenance dispatch." },
  voiceCallVolumeMax: { key: "propertyos.voice.call_volume_max", kind: "LIMIT", label: "Voice calls / day", description: "Combined inbound + outbound AI voice calls in a rolling 24-hour window.", unit: "calls" },
  voiceRecordingEnabled: { key: "propertyos.voice.recording_enabled", kind: "BOOLEAN", label: "Call recording", description: "Whether AI voice calls may be recorded and transcribed, subject to jurisdiction consent rules." },
  /// Phase 22B item 14/15 — real-time voice usage/cost metering, connected to the existing
  /// billing-period usage architecture (`src/modules/entitlements/usage.ts`) exactly like AI
  /// tokens/cost/documents/messages already are.
  voiceInboundMinutesMonthlyMax: { key: "propertyos.voice.inbound_minutes_monthly_max", kind: "LIMIT", label: "Inbound voice minutes / month", description: "Inbound AI voice call minutes consumed in the current billing period.", unit: "minutes" },
  voiceOutboundMinutesMonthlyMax: { key: "propertyos.voice.outbound_minutes_monthly_max", kind: "LIMIT", label: "Outbound voice minutes / month", description: "Outbound AI voice call minutes consumed in the current billing period.", unit: "minutes" },
  voiceHumanTransferEnabled: { key: "propertyos.voice.human_transfer_enabled", kind: "BOOLEAN", label: "Live human transfer", description: "Whether an in-progress AI voice call may be bridged live to a human number." },
  /// Phase 22C item 11 — concurrency ceiling, capability-based (never a hard-coded plan name).
  voiceConcurrentCallsMax: { key: "propertyos.voice.concurrent_calls_max", kind: "LIMIT", label: "Concurrent AI voice calls", description: "AI-handled voice calls (inbound + outbound) that may be simultaneously in progress across the organisation.", unit: "calls" },
  /// Phase 23 — Property Service Professional commercial readiness. Ghana launch keeps every
  /// provider on a free tier with no enforcement; these two keys exist only so a future paid
  /// provider plan has a catalog entry to attach to rather than inventing one ad hoc. Not yet
  /// enforced anywhere: an individual (non-company) provider has no `organisationId` at all, so
  /// the existing org-scoped `assertOperational`/plan machinery has nothing to attach to until a
  /// provider-specific plan model is designed — deliberately out of scope for this phase.
  serviceProviderPublicProfileEnabled: { key: "service_provider.public_profile", kind: "BOOLEAN", label: "Public service-provider profile", description: "Whether a Property Service Professional's profile may be publicly listed on the marketplace. Readiness only in this phase." },
  serviceProviderTeamMembersMax: { key: "service_provider.team_members_max", kind: "LIMIT", label: "Service company team members", description: "Active team members a company-type Property Service Professional may have. Readiness only in this phase.", unit: "members" },
} as const satisfies Record<string, EntitlementDefinition>;

export type EntitlementFeatureKey = (typeof ENTITLEMENTS)[keyof typeof ENTITLEMENTS]["key"];

const BY_KEY = new Map<string, EntitlementDefinition>(Object.values(ENTITLEMENTS).map((definition) => [definition.key, definition]));

export function getEntitlementDefinition(featureKey: string): EntitlementDefinition | undefined {
  return BY_KEY.get(featureKey);
}

export function listEntitlementDefinitions(): EntitlementDefinition[] {
  return [...BY_KEY.values()];
}

export function isKnownFeatureKey(featureKey: string): featureKey is EntitlementFeatureKey {
  return BY_KEY.has(featureKey);
}
