import { describe, expect, it } from "vitest";
import { authorizedSpend, networkCategoryFor, selectRule, type RuleCandidate } from "@/modules/maintenance-routing/evaluate";

const rule = (overrides: Partial<RuleCandidate>): RuleCandidate => ({ id: "r", propertyId: null, unitId: null, category: "plumbing", keywords: [], priorities: [], pausedAt: null, ...overrides });
const facts = { propertyId: "p1", unitId: "u1", category: "plumbing" as const, priority: "URGENT", text: "Kitchen pipe is leaking" };

describe("routing rule selection", () => {
  it("prefers unit over property over organisation rules", () => {
    const rules = [rule({ id: "org" }), rule({ id: "property", propertyId: "p1" }), rule({ id: "unit", propertyId: "p1", unitId: "u1" })];
    expect(selectRule(rules, facts)).toMatchObject({ outcome: "MATCHED", rule: { id: "unit" } });
    expect(selectRule(rules.slice(0, 2), facts)).toMatchObject({ outcome: "MATCHED", rule: { id: "property" } });
    expect(selectRule(rules, { ...facts, propertyId: "p2", unitId: null })).toMatchObject({ outcome: "MATCHED", rule: { id: "org" } });
  });

  it("applies keywords and priorities, and ignores other categories", () => {
    expect(selectRule([rule({ id: "boiler", keywords: ["boiler"] })], facts).outcome).toBe("NO_RULE");
    expect(selectRule([rule({ id: "pipe", keywords: ["pipe"] }), rule({ id: "any" })], facts)).toMatchObject({ rule: { id: "pipe" } });
    expect(selectRule([rule({ priorities: ["EMERGENCY"] })], facts).outcome).toBe("NO_RULE");
    expect(selectRule([rule({ category: "electrical" })], facts).outcome).toBe("NO_RULE");
  });

  it("fails closed on equally specific rules, and a paused rule still wins over a broader one", () => {
    expect(selectRule([rule({ id: "a" }), rule({ id: "b" })], facts)).toMatchObject({ outcome: "AMBIGUOUS_RULES", ruleIds: ["a", "b"] });
    expect(selectRule([rule({ id: "org" }), rule({ id: "paused", propertyId: "p1", pausedAt: new Date() })], facts)).toMatchObject({ rule: { id: "paused" } });
  });

  it("never authorises more than the lower of the rule and provider limits", () => {
    expect(authorizedSpend("PRE_AUTHORIZED", BigInt(50000), BigInt(30000))).toBe(BigInt(30000));
    expect(authorizedSpend("PRE_AUTHORIZED", BigInt(50000), null)).toBe(BigInt(50000));
    expect(authorizedSpend("PRE_AUTHORIZED", null, BigInt(30000))).toBe(BigInt(0));
    expect(authorizedSpend("QUOTE_REQUIRED", BigInt(50000), BigInt(30000))).toBeNull();
  });

  it("maps maintenance categories to network work", () => {
    expect(networkCategoryFor("security", "front door lock broken")).toBe("locksmith");
    expect(networkCategoryFor("sanitation", "rats in the kitchen")).toBe("pest_control");
    expect(networkCategoryFor("structural", "crack in wall")).toBe("building");
    expect(networkCategoryFor("air conditioning", "ac not cooling")).toBe("hvac");
  });
});
