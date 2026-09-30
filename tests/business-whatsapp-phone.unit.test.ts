import { describe, expect, it } from "vitest";
import { normalizeBusinessWhatsAppNumber } from "@/modules/business-whatsapp/phone";

describe("business WhatsApp phone normalization", () => {
  it("normalizes a Ghana local mobile number to E.164", () => {
    expect(normalizeBusinessWhatsAppNumber("024 123 4567")).toBe(
      "+233241234567",
    );
  });

  it("preserves a valid international E.164 number", () => {
    expect(normalizeBusinessWhatsAppNumber("+233241234567")).toBe(
      "+233241234567",
    );
  });

  it("rejects an invalid phone number", () => {
    expect(() => normalizeBusinessWhatsAppNumber("not-a-phone")).toThrow(
      "Enter a valid WhatsApp phone number including the country code.",
    );
  });
});
