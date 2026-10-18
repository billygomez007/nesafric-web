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

export function parseUnitType(raw: string | undefined) {
  if (!raw) return undefined;
  const value = raw.toLowerCase().replace(/\s+/g, " ").trim();
  if (value === "ch" || value === "chamber & hall") return "chamber and hall";
  return (UNIT_TYPES as readonly string[]).includes(value) ? value : null;
}

/** A unit count (auto-named) or unit lines: `A1, apartment, 2` (type and bedrooms optional). */
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
    const [name, type, bedrooms] = cells(text);
    if (!name || name.length > 80) return errors.push({ line: index + 1, text, reason: "A unit needs a name of up to 80 characters." });
    if (seen.has(name.toLowerCase())) return errors.push({ line: index + 1, text, reason: `${name} is listed twice.` });
    const unitType = parseUnitType(type);
    if (unitType === null) return errors.push({ line: index + 1, text, reason: `Unknown unit type "${type}". Use one of: ${UNIT_TYPES.join(", ")}.` });
    if (bedrooms !== undefined && bedrooms !== "" && !/^\d{1,2}$/.test(bedrooms)) return errors.push({ line: index + 1, text, reason: "Bedrooms must be a whole number." });
    seen.add(name.toLowerCase());
    units.push({ name, ...(unitType ? { unitType } : {}), ...(bedrooms ? { bedrooms: Number(bedrooms) } : {}) });
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
