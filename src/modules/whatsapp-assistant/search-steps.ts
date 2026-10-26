import type { WhatsAppInteractive } from "@/modules/conversations/channels/whatsapp-interactive";
import { formatAmount, typeLabel } from "./property-cards";
import { propertyFiltersSchema, type AssistantState } from "./schemas";

/**
 * Step-by-step property search, after rent or buy: type (from what is published), bedrooms, area
 * and budget. Each step can be answered by tapping, by typing, or skipped ("any"); the area is the
 * only one that must be given. A search started with a full sentence ("2 bedroom flat in Osu under
 * 5000") skips the steps it already answers.
 */
export type SearchStep = "type" | "bedrooms" | "area" | "budget";
type Prompt = { reply: string; interactive?: WhatsAppInteractive };
export type InventoryType = { category: string; count: number };

/** Menu answers that start a guided search. */
export const GUIDED_START = /^(rent|buy|land|office|shop|warehouse|other commercial|commercial)$/;
const SKIP = /^(any|skip|any type|any bedrooms|any budget|no preference|none|not sure)$/;
const NON_RESIDENTIAL = new Set(["LAND", "OFFICE", "SHOP", "WAREHOUSE", "COMMERCIAL"]);
const CATEGORIES = propertyFiltersSchema.shape.category.unwrap().options;
type Category = (typeof CATEGORIES)[number];

export function nextSearchStep(state: AssistantState): SearchStep | undefined {
  const filters = state.property;
  const answered = new Set(state.searchAnswered);
  if (!answered.has("type") && !filters.category) return "type";
  if (!answered.has("bedrooms") && filters.bedroomsMin === undefined && filters.bedroomsMax === undefined && !NON_RESIDENTIAL.has(filters.category ?? "")) return "bedrooms";
  if (!filters.location) return "area";
  if (!answered.has("budget") && !filters.maxPriceMinor && !filters.minPriceMinor) return "budget";
  return undefined;
}

const category = (word: string): Category | undefined => {
  const value = word.trim().toUpperCase().replace(/\s+/g, "_").replace(/S$/, "");
  return CATEGORIES.find((option) => option === value || typeLabel(option).toUpperCase() === word.trim().toUpperCase());
};

const RENT_BUDGETS: Array<[string, string]> = [["0-2000", "Under 2,000 a month"], ["2000-5000", "2,000–5,000 a month"], ["5000-10000", "5,000–10,000 a month"], ["10000+", "Over 10,000 a month"]];
const SALE_BUDGETS: Array<[string, string]> = [["0-500000", "Under 500,000"], ["500000-1000000", "500,000–1 million"], ["1000000-3000000", "1–3 million"], ["3000000+", "Over 3 million"]];

/**
 * Applies a tapped or typed answer to the current step. Returns false when the text is not an
 * answer to it, so the caller can read it as free text (a typed budget, a filter change).
 */
export function answerSearchStep(state: AssistantState, step: SearchStep, said: string): boolean {
  const text = said.trim().toLowerCase();
  const filters = state.property;
  const done = () => { state.searchAnswered = [...new Set([...state.searchAnswered, step])]; return true; };
  if (step !== "area" && SKIP.test(text)) return done();
  if (step === "type") {
    const picked = category(text.replace(/^type\s+/, ""));
    if (!picked) return false;
    filters.category = picked;
    return done();
  }
  if (step === "bedrooms") {
    const value = text.replace(/^bedrooms\s+/, "").replace(/\s*(bed(room)?s?|br)$/, "").trim();
    if (value === "studio" || value === "0") { filters.bedroomsMin = 0; filters.bedroomsMax = 0; return done(); }
    const range = /^(\d{1,2})\s*(?:-|to)\s*(\d{1,2})$/.exec(value);
    const plus = /^(\d{1,2})\s*\+$/.exec(value);
    const exact = /^(\d{1,2})$/.exec(value);
    if (range && Number(range[1]) <= Number(range[2])) { filters.bedroomsMin = Number(range[1]); filters.bedroomsMax = Number(range[2]); return done(); }
    if (plus) { filters.bedroomsMin = Number(plus[1]); filters.bedroomsMax = undefined; return done(); }
    if (exact) { filters.bedroomsMin = Number(exact[1]); filters.bedroomsMax = Number(exact[1]); return done(); }
    return false;
  }
  if (step === "area") {
    const area = said.trim().replace(/^(in|at|around|near)\s+/i, "");
    if (area.length < 2 || area.length > 150 || /^\d+$/.test(area) || SKIP.test(text)) return false;
    filters.location = area;
    return true;
  }
  const band = /^budget\s+(\d+)(?:-(\d+)|\+)$/.exec(text);
  if (!band) return false;
  filters.minPriceMinor = band[1] === "0" ? undefined : String(BigInt(band[1]) * BigInt(100));
  filters.maxPriceMinor = band[2] ? String(BigInt(band[2]) * BigInt(100)) : undefined;
  if (filters.listingType === "RENT") filters.frequency = "MONTHLY";
  return done();
}

export function searchStepPrompt(state: AssistantState, step: SearchStep, inventory: InventoryType[]): Prompt {
  const purpose = state.property.listingType === "SALE" ? "to buy" : "to rent";
  if (step === "type") {
    // Only types that have published listings for this purpose, most first; at most 9 plus "Any".
    const types = inventory.filter((item) => category(item.category)).sort((a, b) => b.count - a.count).slice(0, 9);
    const text = `What type of property ${purpose}?${types.length ? "" : " Reply apartment, house, land, office or shop."} Reply any to see every type.`;
    if (!types.length) return { reply: text };
    return { reply: `${text}\n${types.map((item) => `• ${typeLabel(category(item.category)!)} (${item.count})`).join("\n")}`, interactive: { type: "list", body: `What type of property ${purpose}?`, button: "Choose type", sections: [{ rows: [...types.map((item) => ({ id: `type ${category(item.category)!.toLowerCase()}`, title: typeLabel(category(item.category)!).slice(0, 24), description: `${item.count} published` })), { id: "any type", title: "Any type" }] }] } };
  }
  if (step === "bedrooms") {
    const rows = [["0", "Studio"], ["1", "1 bedroom"], ["2", "2 bedrooms"], ["3", "3 bedrooms"], ["4", "4 bedrooms"], ["5+", "5 or more"]];
    return { reply: "How many bedrooms? Reply studio, a number (2), a range (2-3), 5+ or any.", interactive: { type: "list", body: "How many bedrooms? Choose one, or type a range such as 2-3.", button: "Choose bedrooms", sections: [{ rows: [...rows.map(([id, title]) => ({ id: `bedrooms ${id}`, title })), { id: "any bedrooms", title: "Any number" }] }] } };
  }
  if (step === "area") return { reply: "Which area? Type a neighbourhood, town or city, for example Dzorwulu, East Legon, Airport Residential, Kasoa or Kumasi." };
  const currency = state.property.currencyCode ?? "GHS";
  const bands = state.property.listingType === "SALE" ? SALE_BUDGETS : RENT_BUDGETS;
  return {
    reply: `What is your budget (${currency})? Choose a range, type an amount such as under 4000 a month, or reply any.`,
    interactive: { type: "list", body: `What is your budget in ${currency}? Choose a range, or type an amount such as "under 4000 a month".`, button: "Choose budget", sections: [{ rows: [...bands.map(([id, title]) => ({ id: `budget ${id}`, title })), { id: "any budget", title: "Any budget" }] }] },
  };
}

/** The filters in words, for the line above the results. */
export function describeFilters(filters: AssistantState["property"]) {
  const parts = [
    filters.listingType === "SALE" ? "To buy" : "To rent",
    filters.category ? typeLabel(filters.category) : null,
    filters.bedroomsMin === 0 && filters.bedroomsMax === 0 ? "studio" : filters.bedroomsMin !== undefined && filters.bedroomsMax === undefined ? `${filters.bedroomsMin}+ bedrooms` : filters.bedroomsMin !== undefined && filters.bedroomsMax !== filters.bedroomsMin ? `${filters.bedroomsMin}–${filters.bedroomsMax} bedrooms` : filters.bedroomsMin !== undefined ? `${filters.bedroomsMin} bedroom${filters.bedroomsMin === 1 ? "" : "s"}` : null,
    filters.location ? `in ${filters.location}` : null,
    filters.minPriceMinor || filters.maxPriceMinor ? `${filters.minPriceMinor ? `from ${formatAmount(filters.minPriceMinor, filters.currencyCode ?? "GHS")}` : ""}${filters.minPriceMinor && filters.maxPriceMinor ? " " : ""}${filters.maxPriceMinor ? `up to ${formatAmount(filters.maxPriceMinor, filters.currencyCode ?? "GHS")}` : ""}${filters.frequency ? ` ${({ DAILY: "a day", PER_NIGHT: "a night", MONTHLY: "a month", QUARTERLY: "a quarter", ANNUAL: "a year" } as Record<string, string>)[filters.frequency] ?? ""}` : ""}` : null,
  ].filter(Boolean);
  return `Filters: ${parts.join(", ")}.`;
}
