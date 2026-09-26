import type { LeadInput } from "@/api/types";

/**
 * Guest enquiry / viewing request validation. Mirrors the server's `createMarketplaceLeadSchema`
 * and `createViewingRequestSchema` (web repo, `src/modules/listings/schemas.ts`) so people get
 * instant feedback, while the server stays the authority.
 */
export type EnquiryForm = {
  name: string;
  phone: string;
  email: string;
  message: string;
  /** Required: permission to share these details with the listing's owner/agent. */
  shareConsent: boolean;
  /** Optional: follow-up communication beyond this enquiry (the API's `marketingConsent`). */
  marketingConsent: boolean;
};

export type EnquiryErrors = Partial<Record<"name" | "phone" | "email" | "message" | "shareConsent" | "slots", string>>;

export const EMPTY_ENQUIRY: EnquiryForm = { name: "", phone: "", email: "", message: "", shareConsent: false, marketingConsent: false };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Accepts local ("024 123 4567") and international ("+233 24 123 4567") numbers. */
export function isValidPhone(value: string) {
  if (!/^\+?[\d\s()-]+$/.test(value)) return false;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 9 && digits.length <= 15;
}

export function validateEnquiry(form: EnquiryForm, options: { requireSlots?: boolean; slotCount?: number } = {}): EnquiryErrors {
  const errors: EnquiryErrors = {};
  const name = form.name.trim();
  const phone = form.phone.trim();
  const email = form.email.trim();
  if (name.length < 2) errors.name = "Enter your name.";
  else if (name.length > 160) errors.name = "Name is too long.";
  if (!phone && !email) errors.phone = "Add a phone number or email so they can reply.";
  if (phone && !isValidPhone(phone)) errors.phone = "Enter a valid phone number.";
  if (email && (!EMAIL.test(email) || email.length > 320)) errors.email = "Enter a valid email address.";
  if (form.message.trim().length > 2000) errors.message = "Keep your message under 2,000 characters.";
  if (!form.shareConsent) errors.shareConsent = "Please confirm we can share your details with the lister.";
  if (options.requireSlots && !options.slotCount) errors.slots = "Choose at least one time that suits you.";
  return errors;
}

export function toLeadInput(form: EnquiryForm, kind: "CONTACT" | "VIEWING"): LeadInput {
  const trimmed = (value: string) => value.trim() || undefined;
  return {
    name: form.name.trim(),
    phone: trimmed(form.phone),
    email: trimmed(form.email),
    message: trimmed(form.message),
    marketingConsent: form.marketingConsent,
    source: kind === "VIEWING" ? "MOBILE_APP_VIEWING" : "MOBILE_APP",
  };
}

export type ViewingSlot = { key: string; dayLabel: string; periodLabel: string; startsAt: Date; endsAt: Date };

const PERIODS = [
  { key: "morning", label: "9am–12pm", start: 9, end: 12 },
  { key: "midday", label: "12–3pm", start: 12, end: 15 },
  { key: "afternoon", label: "3–6pm", start: 15, end: 18 },
] as const;

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Viewing windows for the next `days` days, starting tomorrow, in the device's local time. */
export function upcomingViewingSlots(now: Date, days = 7): ViewingSlot[] {
  const slots: ViewingSlot[] = [];
  for (let offset = 1; offset <= days; offset++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const dayLabel = `${DAY_NAMES[day.getDay()]} ${day.getDate()} ${MONTH_NAMES[day.getMonth()]}`;
    for (const period of PERIODS) {
      slots.push({
        key: `${day.getFullYear()}-${day.getMonth() + 1}-${day.getDate()}-${period.key}`,
        dayLabel,
        periodLabel: period.label,
        startsAt: new Date(day.getFullYear(), day.getMonth(), day.getDate(), period.start),
        endsAt: new Date(day.getFullYear(), day.getMonth(), day.getDate(), period.end),
      });
    }
  }
  return slots;
}

export const MAX_VIEWING_SLOTS = 3; // The API accepts up to 5.

export function deviceTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Africa/Accra";
  } catch {
    return "Africa/Accra";
  }
}
