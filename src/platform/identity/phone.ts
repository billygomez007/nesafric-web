import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";

/**
 * Phone identity for sign-in: one canonical E.164 string per number (`+233241234567`), used as the
 * database key and the SMS destination. Formatting for display is separate (`formatPhoneForDisplay`)
 * and never used as identity. Parsing and validation use libphonenumber's full metadata, so
 * impossible numbers and numbers that can't receive SMS (fixed lines, premium, toll-free) are
 * rejected rather than guessed at.
 *
 * Ghana is the default region, so local forms ("024 123 4567", "0241234567") and the country code
 * without "+" ("233241234567") all resolve to the same number. International numbers are accepted
 * when written with "+" (or "00").
 */
export const DEFAULT_PHONE_COUNTRY: CountryCode = "GH";

const SMS_CAPABLE = new Set(["MOBILE", "FIXED_LINE_OR_MOBILE", "PERSONAL_NUMBER"]);

export function normalizePhone(raw: unknown, defaultCountry: CountryCode = DEFAULT_PHONE_COUNTRY): string | null {
  if (typeof raw !== "string") return null;
  let input = raw.trim();
  if (!input || input.length > 32 || /[a-z]/i.test(input)) return null;
  if (input.startsWith("00")) input = `+${input.slice(2)}`;
  const parsed = parsePhoneNumberFromString(input, { defaultCountry, extract: false });
  if (!parsed?.isValid()) return null;
  const type = parsed.getType();
  if (type && !SMS_CAPABLE.has(type)) return null;
  return parsed.number;
}

export function formatPhoneForDisplay(e164: string) {
  const parsed = parsePhoneNumberFromString(e164);
  return parsed ? parsed.formatInternational() : e164;
}

/** `+233 24 *** 4567` — confirms where a code went without echoing the whole number. */
export function maskPhone(e164: string) {
  const parsed = parsePhoneNumberFromString(e164);
  if (!parsed) return "your phone";
  const national = String(parsed.nationalNumber);
  return `+${parsed.countryCallingCode} ${national.slice(0, 2)} *** ${national.slice(-4)}`;
}
