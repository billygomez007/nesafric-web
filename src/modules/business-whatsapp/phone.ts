import {
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";

const E164_PATTERN = /^\+[1-9][0-9]{6,14}$/;

export function normalizeBusinessWhatsAppNumber(
  input: string,
  defaultCountry: CountryCode = "GH",
) {
  const value = input.trim();
  const phone = parsePhoneNumberFromString(value, defaultCountry);

  if (!phone || !phone.isValid() || !E164_PATTERN.test(phone.number)) {
    throw new Error(
      "Enter a valid WhatsApp phone number including the country code.",
    );
  }

  return phone.number;
}
