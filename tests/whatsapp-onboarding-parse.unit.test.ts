import { describe, expect, it } from "vitest";
import { parseAmountMinor, parseDate, parseProviders, parseTenants, parseUnits } from "@/modules/whatsapp-assistant/onboarding/parse";

describe("WhatsApp onboarding parsers", () => {
  it("numbers units automatically from a count", () => {
    expect(parseUnits("3", "Block A ")).toEqual({ units: [{ name: "Block A 1" }, { name: "Block A 2" }, { name: "Block A 3" }], errors: [], autoNamed: true });
    expect(parseUnits("0", "Unit ").errors).toHaveLength(1);
  });

  it("reads unit lines with optional type and bedrooms, and reports bad lines", () => {
    expect(parseUnits("A1, apartment, 2\nA2, studio\nA3", "Unit ").units).toEqual([{ name: "A1", unitType: "apartment", bedrooms: 2 }, { name: "A2", unitType: "studio" }, { name: "A3" }]);
    const bad = parseUnits("A1, castle\nA1\nA2, room, two", "Unit ");
    expect(bad.errors.map((error) => error.line)).toEqual([1, 3]);
    expect(parseUnits("A1\nA1", "Unit ").errors[0].reason).toContain("twice");
  });

  it("converts amounts to minor units without floating point", () => {
    expect(parseAmountMinor("1,500")).toBe("150000");
    expect(parseAmountMinor("GHS 99.5")).toBe("9950");
    expect(parseAmountMinor("0")).toBe("0");
    expect(parseAmountMinor("-5")).toBeNull();
    expect(parseAmountMinor("1.234")).toBeNull();
  });

  it("accepts only real calendar dates", () => {
    expect(parseDate("2026-02-28")).toBe("2026-02-28");
    expect(parseDate("2026-02-30")).toBeNull();
    expect(parseDate("28/02/2026")).toBeNull();
  });

  it("reads tenant lines and rejects incomplete or invalid ones", () => {
    const parsed = parseTenants("A1, Kofi Mensah, 0241234567, 1500, monthly, 2026-01-01, 2026-12-31\nA2, Esi Boateng, -, 12000, yearly, 2026-03-01\nA3, Ama, 12, 100, monthly, 2026-01-01\nA4, Yaw, -, 100, weekly, 2026-01-01");
    expect(parsed.tenants).toEqual([
      { unitRef: "A1", legalName: "Kofi Mensah", phone: "+233241234567", rentAmountMinor: "150000", rentFrequency: "MONTHLY", startDate: "2026-01-01", endDate: "2026-12-31" },
      { unitRef: "A2", legalName: "Esi Boateng", rentAmountMinor: "1200000", rentFrequency: "ANNUAL", startDate: "2026-03-01" },
    ]);
    expect(parsed.errors.map((error) => error.line)).toEqual([3, 4]);
    expect(parseTenants("A1, Kofi, -, 100, monthly, 2026-05-01, 2026-01-01").errors[0].reason).toContain("before the start");
  });

  it("reads maintenance professionals with a known category", () => {
    expect(parseProviders("Kwame Plumbing, 0201234567, plumber").providers).toEqual([{ name: "Kwame Plumbing", phone: "+233201234567", category: "plumber" }]);
    expect(parseProviders("Kwame, 0201234567, wizard").errors).toHaveLength(1);
  });
});
