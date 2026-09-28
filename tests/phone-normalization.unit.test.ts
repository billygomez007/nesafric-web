import { describe, expect, it } from "vitest";

import { formatPhoneForDisplay, maskPhone, normalizePhone } from "@/platform/identity/phone";

describe("phone normalisation (E.164 identity)", () => {
  it.each(["024 123 4567", "0241234567", "233241234567", "+233241234567", "+233 24 123 4567", "00233241234567", " (024) 123-4567 "])(
    "normalises Ghana %j to +233241234567",
    (input) => expect(normalizePhone(input)).toBe("+233241234567"),
  );

  it("covers every Ghana mobile network prefix", () => {
    for (const prefix of ["020", "023", "024", "026", "027", "028", "050", "053", "054", "055", "056", "057", "059"]) {
      expect(normalizePhone(`${prefix}1234567`)).toBe(`+233${prefix.slice(1)}1234567`);
    }
  });

  it("accepts international mobile numbers written with + (or 00)", () => {
    expect(normalizePhone("+234 803 123 4567")).toBe("+2348031234567");
    expect(normalizePhone("+44 7911 123456")).toBe("+447911123456");
    expect(normalizePhone("0044 7911 123456")).toBe("+447911123456");
    // Ofcom's range reserved for fiction is not a real number.
    expect(normalizePhone("+44 7700 900123")).toBeNull();
  });

  it.each(["", "   ", "12345", "024 123", "02412345678901", "+233 30 212 3456", "+1 800 555 0100", "abc", "024-ABC-4567", "+999 1234567", 42, null])(
    "rejects impossible or non-SMS numbers: %j",
    (input) => expect(normalizePhone(input)).toBeNull(),
  );

  it("formats and masks for display without changing identity", () => {
    expect(formatPhoneForDisplay("+233241234567")).toBe("+233 24 123 4567");
    expect(maskPhone("+233241234567")).toBe("+233 24 *** 4567");
  });
});
