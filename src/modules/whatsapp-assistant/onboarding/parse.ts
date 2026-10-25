import { normalizePhone } from "@/platform/identity/phone";

/**
 * Deterministic parsers for the structured lines landlords send during onboarding. They never
 * guess: a line that does not parse is reported back with its line number and nothing is saved
 * for it.
 */

export const UNIT_TYPES = ["apartment", "studio", "room", "chamber and hall", "house", "townhouse", "shop", "office", "warehouse", "other"] as const;
export const PROVIDER_CATEGORIES = ["plumber", "electrician", "carpenter", "painter", "locksmith", "hvac", "cleaning", "pest control", "general maintenance", "builder"] as const;

export type DraftUnit = { name: string; unitType?: string; bedrooms?: number };
export type LineError = { line: number; text: string; reason: string };

const lines = (body: string) => body.split(/\r?\n/).map((text) => text.trim()).filter(Boolean);
const cells = (line: string) => line.split(",").map((cell) => cell.trim());

/** Everyday names landlords use for the unit types above. */
const UNIT_TYPE_SYNONYMS: Record<string, string> = { flat: "apartment", "single room": "room", ch: "chamber and hall", "chamber hall": "chamber and hall" };
const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
/** A unit name such as A1, B-2, 12, Flat 1 or Shop 3B: a short label that ends in a number. */
const UNIT_NAME = /^[a-z]{0,12}[ -]?\d{1,4}[a-z]?$/i;

export function parseUnitType(raw: string | undefined) {
  if (!raw) return undefined;
  const value = raw.toLowerCase().replace(/&/g, " and ").replace(/[-\s]+/g, " ").trim();
  const known = (candidate: string) => (UNIT_TYPES as readonly string[]).includes(candidate) ? candidate : UNIT_TYPE_SYNONYMS[candidate] ?? null;
  // "apartments" or "flats" are read as their singular.
  return known(value) ?? (value.endsWith("s") ? known(value.slice(0, -1)) : null);
}

/** "3 bedrooms apartment", "2-bedroom flat", "one bed apartment", "4 bedroom" or a plain type. */
export function parseUnitDescription(raw: string): { unitType?: string; bedrooms?: number } | null {
  const value = raw.toLowerCase().replace(/[-\s]+/g, " ").trim();
  const match = value.match(/^(\d{1,2}|[a-z]+)\s*(?:bed(?:room)?s?|br)(?:\s+(.+))?$/);
  if (match) {
    const bedrooms = /^\d+$/.test(match[1]) ? Number(match[1]) : NUMBER_WORDS[match[1]];
    if (bedrooms === undefined) return null;
    if (!match[2]) return { bedrooms };
    const unitType = parseUnitType(match[2]);
    return unitType ? { unitType, bedrooms } : null;
  }
  const unitType = parseUnitType(value);
  return unitType ? { unitType } : null;
}

/** A unit count (auto-named), unit names on one line (`A1, A2, A3`), or unit lines: `A1, apartment, 2` or `A1, 3 bedroom apartment` (type and bedrooms optional). */
export function parseUnits(body: string, prefix: string): { units: DraftUnit[]; errors: LineError[]; autoNamed: boolean } {
  const trimmed = body.trim();
  if (/^\d{1,3}$/.test(trimmed)) {
    const count = Number(trimmed);
    if (count < 1 || count > 500) return { units: [], errors: [{ line: 1, text: trimmed, reason: "Send between 1 and 500 units." }], autoNamed: true };
    return { units: Array.from({ length: count }, (_, index) => ({ name: `${prefix}${index + 1}` })), errors: [], autoNamed: true };
  }
  const units: DraftUnit[] = [];
  const errors: LineError[] = [];
  const seen = new Set<string>();
  lines(body).forEach((text, index) => {
    const parts = cells(text);
    // "A1, A2, A3": every cell is a unit name, so each one is a unit.
    if (parts.length > 1 && parts.every((part) => UNIT_NAME.test(part))) {
      for (const name of parts) {
        if (seen.has(name.toLowerCase())) { errors.push({ line: index + 1, text, reason: `${name} is listed twice.` }); continue; }
        seen.add(name.toLowerCase());
        units.push({ name });
      }
      return;
    }
    const [name, type, bedroomsCell] = parts;
    if (!name || name.length > 80) return errors.push({ line: index + 1, text, reason: "A unit needs a name of up to 80 characters." });
    if (seen.has(name.toLowerCase())) return errors.push({ line: index + 1, text, reason: `${name} is listed twice.` });
    const description = type ? parseUnitDescription(type) : {};
    if (description === null) return errors.push({ line: index + 1, text, reason: `Unknown unit type "${type}". Use one of: ${UNIT_TYPES.join(", ")} (for example "3 bedroom apartment"). To list several units on one line, separate the names with commas, like A1, A2, A3.` });
    let bedrooms = description.bedrooms;
    if (bedroomsCell !== undefined && bedroomsCell !== "") {
      const match = bedroomsCell.toLowerCase().match(/^(\d{1,2})(?:\s*bed(?:room)?s?)?$/);
      if (!match) return errors.push({ line: index + 1, text, reason: "Bedrooms must be a whole number." });
      if (bedrooms !== undefined && bedrooms !== Number(match[1])) return errors.push({ line: index + 1, text, reason: `The bedrooms are given twice (${bedrooms} and ${match[1]}). Give them once.` });
      bedrooms = Number(match[1]);
    }
    seen.add(name.toLowerCase());
    units.push({ name, ...(description.unitType ? { unitType: description.unitType } : {}), ...(bedrooms ? { bedrooms } : {}) });
  });
  if (units.length > 500) return { units: [], errors: [{ line: 501, text: "", reason: "Send at most 500 units per building." }], autoNamed: false };
  return { units, errors, autoNamed: false };
}

/** `1500` or `1,500.50` → minor units as a string. Rejects negatives and more than 2 decimals. */
export function parseAmountMinor(raw: string) {
  const value = raw.replace(/[,\s]/g, "").replace(/^(ghs|gh₵|₵)/i, "");
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return (BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0") || "0")).toString();
}

export function parseDate(raw: string | undefined) {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().startsWith(raw) ? raw : null;
}

const FREQUENCIES: Record<string, "MONTHLY" | "QUARTERLY" | "ANNUAL"> = { monthly: "MONTHLY", month: "MONTHLY", quarterly: "QUARTERLY", yearly: "ANNUAL", annual: "ANNUAL", annually: "ANNUAL", year: "ANNUAL" };

export type DraftTenant = { unitRef: string; legalName: string; phone?: string; rentAmountMinor: string; rentFrequency: "MONTHLY" | "QUARTERLY" | "ANNUAL"; startDate: string; endDate?: string };

/** `unit, full name, phone, rent, frequency, start date[, end date]`; phone may be `-`. */
export function parseTenants(body: string): { tenants: DraftTenant[]; errors: LineError[] } {
  const tenants: DraftTenant[] = [];
  const errors: LineError[] = [];
  lines(body).forEach((text, index) => {
    const parts = cells(text);
    if (parts.length < 6 || parts.length > 7) return errors.push({ line: index + 1, text, reason: "Use: unit, full name, phone, rent, frequency, start date, end date (end date optional)." });
    const [unitRef, legalName, rawPhone, rent, frequency, start, end] = parts;
    if (!unitRef) return errors.push({ line: index + 1, text, reason: "The unit is missing." });
    if (legalName.length < 2 || legalName.length > 200) return errors.push({ line: index + 1, text, reason: "The tenant name must be 2 to 200 characters." });
    const phone = rawPhone === "-" || rawPhone === "" ? undefined : normalizePhone(rawPhone);
    if (phone === null) return errors.push({ line: index + 1, text, reason: `"${rawPhone}" is not a valid mobile number. Use - if unknown.` });
    const rentAmountMinor = parseAmountMinor(rent);
    if (!rentAmountMinor) return errors.push({ line: index + 1, text, reason: `"${rent}" is not a valid rent amount.` });
    const rentFrequency = FREQUENCIES[frequency.toLowerCase()];
    if (!rentFrequency) return errors.push({ line: index + 1, text, reason: "Frequency must be monthly, quarterly or yearly." });
    const startDate = parseDate(start);
    if (!startDate) return errors.push({ line: index + 1, text, reason: "Start date must be YYYY-MM-DD." });
    const endDate = end ? parseDate(end) : undefined;
    if (endDate === null) return errors.push({ line: index + 1, text, reason: "End date must be YYYY-MM-DD." });
    if (endDate && endDate < startDate) return errors.push({ line: index + 1, text, reason: "End date is before the start date." });
    tenants.push({ unitRef, legalName, ...(phone ? { phone } : {}), rentAmountMinor, rentFrequency, startDate, ...(endDate ? { endDate } : {}) });
  });
  return { tenants, errors };
}

export type DraftProvider = { name: string; phone: string; category: string };

/** `name, phone, category`. */
export function parseProviders(body: string): { providers: DraftProvider[]; errors: LineError[] } {
  const providers: DraftProvider[] = [];
  const errors: LineError[] = [];
  lines(body).forEach((text, index) => {
    const [name, rawPhone, rawCategory] = cells(text);
    if (!name || name.length < 2 || name.length > 160) return errors.push({ line: index + 1, text, reason: "Use: name, phone, category." });
    const phone = normalizePhone(rawPhone);
    if (!phone) return errors.push({ line: index + 1, text, reason: `"${rawPhone ?? ""}" is not a valid mobile number.` });
    const category = rawCategory?.toLowerCase().trim();
    if (!category || !(PROVIDER_CATEGORIES as readonly string[]).includes(category)) return errors.push({ line: index + 1, text, reason: `Category must be one of: ${PROVIDER_CATEGORIES.join(", ")}.` });
    providers.push({ name, phone, category });
  });
  return { providers, errors };
}

export const formatErrors = (errors: LineError[]) => errors.slice(0, 5).map((error) => `Line ${error.line}: ${error.reason}`).join("\n") + (errors.length > 5 ? `\n…and ${errors.length - 5} more.` : "");

export function formatMinor(minor: string, currency: string) {
  const value = BigInt(minor);
  const hundred = BigInt(100);
  return `${currency} ${(value / hundred).toString()}${value % hundred ? `.${(value % hundred).toString().padStart(2, "0")}` : ""}`;
}
