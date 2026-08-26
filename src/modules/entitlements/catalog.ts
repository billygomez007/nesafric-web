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
