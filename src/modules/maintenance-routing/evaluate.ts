import type { NetworkCategory } from "@/modules/provider-network/categories";

/** The provider-network category that handles a maintenance request category. */
export function networkCategoryFor(category: string, text: string): NetworkCategory {
  const input = text.toLowerCase();
  switch (category) {
    case "plumbing": return "plumbing";
    case "electrical": return "electrical";
    case "carpentry": return "carpentry";
    case "painting": return "painting";
    case "air conditioning": return "hvac";
    case "security": return /\b(lock\w*|key|keys|padlock)\b/.test(input) ? "locksmith" : "general_maintenance";
    case "sanitation": return /\b(pests?|rats?|mice|cockroach\w*|termites?|bed ?bugs?|fumigat\w*)\b/.test(input) ? "pest_control" : "cleaning";
    case "structural":
    case "roofing": return "building";
    default: return "general_maintenance";
  }
}

export type RuleCandidate = {
  id: string;
  propertyId: string | null;
  unitId: string | null;
  category: string;
  keywords: string[];
  priorities: string[];
  pausedAt: Date | null;
};
export type RequestFacts = { propertyId: string; unitId: string | null; category: NetworkCategory; priority: string; text: string };

export type RuleSelection<T extends RuleCandidate> =
  | { outcome: "MATCHED"; rule: T }
  | { outcome: "NO_RULE"; reason: string }
  | { outcome: "AMBIGUOUS_RULES"; reason: string; ruleIds: string[] };

const specificity = (rule: RuleCandidate) => (rule.unitId ? 4 : rule.propertyId ? 2 : 0) + (rule.keywords.length ? 1 : 0);

/**
 * Picks the one rule that applies. A rule applies when its scope covers the request (whole
 * organisation, the property, or the unit), its category matches, any keywords appear in the
 * report, and the priority is allowed. The most specific rule wins (unit, then property, then
 * organisation; keywords break ties). Two equally specific rules fail closed: nothing is
 * dispatched and a person decides. A paused rule still wins and blocks automatic dispatch,
 * so pausing never silently falls through to a broader rule.
 */
export function selectRule<T extends RuleCandidate>(rules: T[], facts: RequestFacts): RuleSelection<T> {
  const text = facts.text.toLowerCase();
  const applicable = rules.filter((rule) =>
    rule.category === facts.category
    && (rule.unitId ? rule.unitId === facts.unitId : rule.propertyId ? rule.propertyId === facts.propertyId : true)
    && (!rule.keywords.length || rule.keywords.some((keyword) => text.includes(keyword.toLowerCase())))
    && (!rule.priorities.length || rule.priorities.includes(facts.priority)));
  if (!applicable.length) return { outcome: "NO_RULE", reason: `No routing rule covers ${facts.category} at this property.` };
  const best = Math.max(...applicable.map(specificity));
  const top = applicable.filter((rule) => specificity(rule) === best);
  if (top.length > 1) return { outcome: "AMBIGUOUS_RULES", reason: "Several routing rules apply equally; a person must choose.", ruleIds: top.map((rule) => rule.id) };
  return { outcome: "MATCHED", rule: top[0] };
}

/** The spend a provider may commit without approval: the lower of the rule cap and the provider's own limit. */
export function authorizedSpend(mode: string, ruleCapMinor: bigint | null, providerLimitMinor: bigint | null) {
  if (mode !== "PRE_AUTHORIZED") return null;
  // Pre-authorisation without a cap authorises nothing.
  if (ruleCapMinor === null) return BigInt(0);
  if (providerLimitMinor === null) return ruleCapMinor;
  return ruleCapMinor < providerLimitMinor ? ruleCapMinor : providerLimitMinor;
}
