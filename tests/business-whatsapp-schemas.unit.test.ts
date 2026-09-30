import { describe, expect, it } from "vitest";
import {
  businessWhatsAppConfigInputSchema,
  businessWhatsAppPreferencesInputSchema,
} from "@/modules/business-whatsapp/schemas";

describe("business WhatsApp schemas", () => {
  it("accepts a WhatsApp number with explicit consent", () => {
    const result = businessWhatsAppConfigInputSchema.parse({
      whatsappNumber: "0241234567",
      whatsappOptIn: true,
      inquiryNotifications: true,
      viewingNotifications: false,
    });

    expect(result.whatsappNumber).toBe("0241234567");
    expect(result.whatsappOptIn).toBe(true);
    expect(result.inquiryNotifications).toBe(true);
    expect(result.viewingNotifications).toBe(false);
  });

  it("requires explicit WhatsApp consent state", () => {
    expect(() =>
      businessWhatsAppConfigInputSchema.parse({
        whatsappNumber: "0241234567",
      }),
    ).toThrow();
  });

  it("requires at least one preference when updating preferences", () => {
    expect(() => businessWhatsAppPreferencesInputSchema.parse({})).toThrow(
      "At least one notification preference must be supplied.",
    );
  });

  it("accepts a partial preference update", () => {
    expect(
      businessWhatsAppPreferencesInputSchema.parse({
        bookingNotifications: false,
      }),
    ).toEqual({
      bookingNotifications: false,
    });
  });
});
