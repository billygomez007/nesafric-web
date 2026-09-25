import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_PUBLIC_WRITE_RULES, parsePublicWriteLimitOverrides, publicWriteRules } from "@/platform/security/public-write-limit";

const defaultLimit = (id: string) => Object.values(DEFAULT_PUBLIC_WRITE_RULES).flat().find((rule) => rule.id === id)!.limit;

describe("PUBLIC_WRITE_LIMITS parsing", () => {
  afterEach(() => vi.restoreAllMocks());

  it("applies valid overrides for known rule ids", () => {
    expect(parsePublicWriteLimitOverrides('{"enquiry.ip.10m":40,"viewing.lead.day":2}')).toEqual({
      overrides: { "enquiry.ip.10m": 40, "viewing.lead.day": 2 },
      problems: [],
    });
  });

  it("ignores empty, malformed and non-object settings, keeping every default", () => {
    expect(parsePublicWriteLimitOverrides(undefined)).toEqual({ overrides: {}, problems: [] });
    expect(parsePublicWriteLimitOverrides("   ")).toEqual({ overrides: {}, problems: [] });
    for (const raw of ["{not json", "[1,2]", "42", "null", '"text"']) {
      const result = parsePublicWriteLimitOverrides(raw);
      expect(result.overrides).toEqual({});
      expect(result.problems).toHaveLength(1);
    }
  });

  it("rejects unknown ids (typos) and out-of-range or non-integer values individually", () => {
    const result = parsePublicWriteLimitOverrides(
      '{"enquiry.ip.10mins":40,"enquiry.ip.10m":0,"enquiry.ip.day":1e9,"enquiry.contact.hour":2.5,"enquiry.contact.day":"30","viewing.ip.10m":50}',
    );
    expect(result.overrides).toEqual({ "viewing.ip.10m": 50 });
    expect(result.problems).toHaveLength(5);
    expect(result.problems[0]).toContain('unknown rule id "enquiry.ip.10mins"');
  });

  it("falls back to defaults for rejected values and warns once per distinct setting", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const env = { PUBLIC_WRITE_LIMITS: '{"enquiry.ip.10m":-1,"enquiry.contact.hour":3}' };
    for (let n = 0; n < 5; n++) {
      const rules = publicWriteRules("enquiry", env);
      expect(rules.find((rule) => rule.id === "enquiry.ip.10m")!.limit).toBe(defaultLimit("enquiry.ip.10m"));
      expect(rules.find((rule) => rule.id === "enquiry.contact.hour")!.limit).toBe(3);
    }
    expect(warn).toHaveBeenCalledTimes(1);
    // The warning names the rule, never visitor data.
    expect(String(warn.mock.calls[0][0])).toContain("enquiry.ip.10m");
  });
});
