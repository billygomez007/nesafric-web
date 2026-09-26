import { EMPTY_ENQUIRY, isValidPhone, toLeadInput, upcomingViewingSlots, validateEnquiry } from "@/marketplace/enquiry";

const valid = { ...EMPTY_ENQUIRY, name: "Kofi Mensah", phone: "024 123 4567", shareConsent: true };

describe("guest enquiry validation", () => {
  it("accepts Ghanaian local and international phone numbers", () => {
    expect(isValidPhone("024 123 4567")).toBe(true);
    expect(isValidPhone("+233 24 123 4567")).toBe(true);
    expect(isValidPhone("12345")).toBe(false);
    expect(isValidPhone("call me")).toBe(false);
  });

  it("requires a name, a way to reply and consent to share details", () => {
    expect(validateEnquiry(valid)).toEqual({});
    expect(validateEnquiry(EMPTY_ENQUIRY)).toEqual({
      name: "Enter your name.",
      phone: "Add a phone number or email so they can reply.",
      shareConsent: "Please confirm we can share your details with the lister.",
    });
    expect(validateEnquiry({ ...valid, phone: "", email: "ama@example.com" })).toEqual({});
    expect(validateEnquiry({ ...valid, email: "not-an-email" })).toEqual({ email: "Enter a valid email address." });
  });

  it("requires at least one viewing time for viewing requests", () => {
    expect(validateEnquiry(valid, { requireSlots: true, slotCount: 0 })).toEqual({ slots: "Choose at least one time that suits you." });
    expect(validateEnquiry(valid, { requireSlots: true, slotCount: 2 })).toEqual({});
  });

  it("builds the API payload without empty fields and with explicit marketing consent", () => {
    expect(toLeadInput({ ...valid, email: "  ", message: " Is it available? " }, "VIEWING")).toEqual({
      name: "Kofi Mensah",
      phone: "024 123 4567",
      email: undefined,
      message: "Is it available?",
      marketingConsent: false,
      source: "MOBILE_APP_VIEWING",
    });
  });

  it("offers future viewing windows only, starting tomorrow", () => {
    const now = new Date(2026, 8, 25, 21, 0);
    const slots = upcomingViewingSlots(now, 2);
    expect(slots).toHaveLength(6);
    expect(slots.every((slot) => slot.startsAt > now && slot.endsAt > slot.startsAt)).toBe(true);
    expect(slots[0]).toMatchObject({ dayLabel: "Sat 26 Sep", periodLabel: "9am–12pm" });
  });
});
