/**
 * Deterministic understanding of WhatsApp messages: commands, intents and the structured fields a
 * workflow needs (transaction type, property type, budget, bedrooms, location, dates). It needs no
 * AI provider, so the assistant keeps working when the AI service is down; the optional AI layer
 * (`ai-extract.ts`) only fills gaps this parser leaves, and its output is validated the same way.
 *
 * Every function here is pure. Nothing in a message can change permissions or trigger an action
 * by itself — workflows decide what to do with the parsed fields.
 */

export type Command = "menu" | "cancel" | "help" | "stop" | "start" | "resume" | "status" | "support" | "back" | "skip" | "done" | "more";

export type Intent =
  | "greeting"
  | "property_search"
  | "service_search"
  | "register_business"
  | "register_agent"
  | "register_landlord"
  | "register_provider"
  | "list_property"
  | "edit_listing"
  | "status"
  | "support";

export function normalize(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^\p{L}\p{N}₵$.,'/:\- ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const COMMANDS: Array<[Command, RegExp]> = [
  ["menu", /^(menu|main menu|home|0)$/],
  ["cancel", /^(cancel|quit|exit|abort|stop this|cancel (this|it|that|listing|registration|search))$/],
  ["help", /^(help|\?|how does this work)$/],
  ["stop", /^(stop|unsubscribe|opt out|stop messages)$/],
  ["start", /^(start|subscribe|opt in)$/],
  ["resume", /^(resume|continue|carry on|go on)$/],
  ["status", /^(status|check status|my status|track)$/],
  ["support", /^(support|talk to support|human|talk to a (person|human)|customer care|speak to someone)$/],
  ["back", /^(back|go back|previous)$/],
  ["skip", /^(skip|none|no|n\/a|na|not now|later|nothing|no thanks)$/],
  ["done", /^(done|finished|that's all|thats all|no more|complete|end)$/],
  ["more", /^(more|see more|show more|next|more results)$/],
];

export function detectCommand(raw: string | undefined): Command | null {
  if (!raw) return null;
  const value = normalize(raw).replace(/[.!]+$/, "");
  for (const [command, pattern] of COMMANDS) if (pattern.test(value)) return command;
  return null;
}

const SERVICE_WORDS = /\b(plumb\w*|electric\w*|carpent\w*|painter|painting|mason\w*|contractor|builder|construction|architect\w*|quantity surveyor|surveyor|lawyer|solicitor|valuer|valuation|clean\w*|pest|fumigat\w*|mover|movers|moving|relocat\w*|interior design\w*|decorator|security guard|security service|guards?|a\/c|air ?con\w*|hvac|technician|handyman|artisan|repair\w*|leak\w*|fix(ing)?|maintenance|welder|tiler|tiling|roofer|roofing|gardener|landscap\w*|cctv|borehole|generator repair|service provider|property manager)\b/;
const PROPERTY_WORDS = /\b(rent|renting|to let|buy|buying|purchase|for sale|apartment|apartments|flat|flats|house|houses|home|land|plot|plots|office|offices|shop|shops|store|warehouse|bedroom|bed room|bedrooms|\d+ ?bed|property|properties|accommodation|hotel|short stay|airbnb|guest house|townhouse|villa|chamber and hall|self contain\w*|single room|commercial space|commercial building)\b/;

/**
 * Classifies a free-text message. Returns every intent found, strongest first, so a message such
 * as "I need an apartment and a plumber" yields two separate tasks.
 */
export function detectIntents(raw: string | undefined): Intent[] {
  if (!raw) return [];
  const value = normalize(raw);
  const intents: Intent[] = [];
  const add = (intent: Intent) => { if (!intents.includes(intent)) intents.push(intent); };

  const editing = /\b(edit|update|change|correct|fix) (my |the )?(listing|property listing|price|photos?|description)\b|^edit\b/.test(value);
  if (!editing && (/\b(nes-[a-z]{2}-[0-9a-f]{4,})\b/.test(value) || /\b(status of|check (my )?(application|listing|request|registration)|track (my )?|my applications?|my listings?|my requests?)\b/.test(value))) add("status");
  if (editing) add("edit_listing");
  if (/\b(talk|speak|chat) (to|with) (a |an )?(human|person|support|someone|agent at nesafric)\b|\bcustomer (care|service)\b|\bcomplain\w*\b/.test(value)) add("support");

  const registerish = /\b(register|registration|sign ?up|onboard|join|create (an |a )?(account|profile)|advertise|list my|add my)\b/.test(value);
  if (/\b(i am|i'm|im|as) (an? )?(real estate |property )?agent\b|\bregister as (an? )?agent\b|\bagent registration\b/.test(value)) add("register_agent");
  else if (registerish && /\b(landlord|property owner|home ?owner)\b/.test(value)) add("register_landlord");
  else if (registerish && (/\bservices?\b|\bbusiness\b/.test(value) && SERVICE_WORDS.test(value) || /\bservice (business|provider|company)\b/.test(value))) add("register_provider");
  else if (registerish && /\b(agency|brokerage|real estate (business|company|firm)|company|developer|development company|property management|marketing company|business)\b/.test(value)) add("register_business");

  if (!intents.some((intent) => intent.startsWith("register")) && /\b(list|post|advertise|upload|add|sell|rent out|let out) (a |my |our |the )?(new )?(property|house|apartment|flat|land|plot|listing|office|shop|home)\b|\bnew listing\b|\blist (a )?property\b/.test(value)) add("list_property");

  const wantsSomething = !intents.includes("list_property") && !intents.some((intent) => intent.startsWith("register"));
  if (wantsSomething && SERVICE_WORDS.test(value)) add("service_search");
  if (wantsSomething && PROPERTY_WORDS.test(value) && !/\bproperty manager\b/.test(value)) {
    // "plumber for my house" is a service request, not a house search.
    const serviceForProperty = intents.includes("service_search") && /\b(for|in|at) (my|our|the) (house|home|apartment|flat|office|shop|property)\b/.test(value);
    if (!serviceForProperty) add("property_search");
  }
  // Property mentioned first in the sentence wins first place when both were asked for.
  if (intents.includes("service_search") && intents.includes("property_search")) {
    const propertyAt = value.search(PROPERTY_WORDS);
    const serviceAt = value.search(SERVICE_WORDS);
    if (propertyAt < serviceAt) {
      intents.splice(intents.indexOf("property_search"), 1);
      intents.splice(intents.indexOf("service_search"), 0, "property_search");
    }
  }
  if (!intents.length && /^(hi|hello|hey|hiya|good (morning|afternoon|evening|day)|greetings|yo|howdy|akwaaba|hi there|hello there|start|get started)\b/.test(value)) add("greeting");
  return intents;
}

// ------------------------------------------------------------------------------------------------
// Property search fields
// ------------------------------------------------------------------------------------------------

export type ListingTypeValue = "RENT" | "SALE";

export const PROPERTY_CATEGORIES: Array<{ key: string; label: string; residential: boolean; pattern: RegExp }> = [
  { key: "APARTMENT", label: "Apartment", residential: true, pattern: /\b(apartments?|flats?|apt|chamber and hall|chamber & hall|self contain\w*|single room|studio)\b/ },
  { key: "TOWNHOUSE", label: "Townhouse", residential: true, pattern: /\btown ?houses?\b/ },
  { key: "VILLA", label: "Villa", residential: true, pattern: /\bvillas?\b/ },
  { key: "GUEST_HOUSE", label: "Guest house", residential: true, pattern: /\bguest ?houses?\b/ },
  { key: "HOTEL", label: "Hotel", residential: true, pattern: /\bhotels?\b/ },
  { key: "SHORT_STAY", label: "Short stay", residential: true, pattern: /\b(short ?stays?|airbnb|holiday (home|let))\b/ },
  { key: "HOUSE", label: "House", residential: true, pattern: /\b(houses?|homes?|bungalows?|duplex|detached|storey building)\b/ },
  { key: "LAND", label: "Land", residential: false, pattern: /\b(land|lands|plots?|acres?)\b/ },
  { key: "OFFICE", label: "Office", residential: false, pattern: /\b(offices?|office space)\b/ },
  { key: "SHOP", label: "Shop / Retail", residential: false, pattern: /\b(shops?|stores?|retail|kiosk)\b/ },
  { key: "WAREHOUSE", label: "Warehouse", residential: false, pattern: /\b(warehouses?|industrial|factory)\b/ },
  { key: "COMMERCIAL", label: "Commercial space", residential: false, pattern: /\b(commercial (space|building|property)|event (space|centre|center))\b/ },
];

export function categoryLabel(key: string | undefined | null) {
  return PROPERTY_CATEGORIES.find((category) => category.key === key)?.label ?? (key ? key.charAt(0) + key.slice(1).toLowerCase().replace(/_/g, " ") : "Property");
}

export function isResidentialCategory(key: string | undefined | null) {
  return PROPERTY_CATEGORIES.find((category) => category.key === key)?.residential ?? false;
}

export function parseCategory(raw: string): string | undefined {
  const value = normalize(raw);
  return PROPERTY_CATEGORIES.find((category) => category.pattern.test(value))?.key;
}

export function parseListingType(raw: string): ListingTypeValue | undefined {
  const value = normalize(raw);
  if (/\b(for sale|buy|buying|purchase|to own|sell|selling|sale)\b/.test(value)) return "SALE";
  if (/\b(rent|renting|rental|to let|lease|let|monthly|per month|a month)\b/.test(value)) return "RENT";
  return undefined;
}

const WORD_NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, single: 1 };

export function parseBedrooms(raw: string): number | undefined {
  const value = normalize(raw);
  if (/\bstudio\b/.test(value)) return 0;
  if (/\b(chamber and hall|chamber & hall|single room|self contain\w*)\b/.test(value)) return 1;
  const match = value.match(/\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)[ -]?(bed(room)?s?|br|bd|bdr)\b/);
  if (!match) return undefined;
  const count = WORD_NUMBERS[match[1]] ?? Number(match[1]);
  return Number.isInteger(count) && count >= 0 && count <= 50 ? count : undefined;
}

export function parseBathrooms(raw: string): number | undefined {
  const value = normalize(raw);
  const match = value.match(/\b(\d{1,2}(?:\.5)?|one|two|three|four|five|six)[ -]?(bath(room)?s?|washrooms?|toilets? and baths?)\b/);
  if (!match) return undefined;
  const count = WORD_NUMBERS[match[1]] ?? Number(match[1]);
  return Number.isFinite(count) && count >= 0 && count <= 50 ? count : undefined;
}

export function parseFurnishing(raw: string): "FURNISHED" | "SEMI_FURNISHED" | "UNFURNISHED" | undefined {
  const value = normalize(raw);
  if (/\b(semi[ -]?furnished|partly furnished|partially furnished)\b/.test(value)) return "SEMI_FURNISHED";
  if (/\b(unfurnished|not furnished|no furniture|empty)\b/.test(value)) return "UNFURNISHED";
  if (/\bfurnished\b/.test(value)) return "FURNISHED";
  return undefined;
}

/**
 * A money amount in whole currency units → minor units (pesewas) as a string. Understands
 * "GHS 4,000", "₵4000", "4k", "2 million", "2m", "1.5m", "2,500 cedis". Returns undefined when the
 * text holds no recognisable amount — never guesses.
 */
export function parseMoneyMinor(raw: string): string | undefined {
  const value = normalize(raw).replace(/(\d),(?=\d{3}\b)/g, "$1");
  const match = value.match(/(?:ghs|gh₵|ghc|₵|cedis?|\$|usd)?\s*(\d+(?:\.\d+)?)\s*(k|thousand|m|mil|million|mn|bn|billion)?\b(?!\s*(bed|bath|sqm|m2|square|acre|plot|night|guest|person|people|hour|am|pm|:))/);
  if (!match) return undefined;
  let amount = Number(match[1]);
  const scale = match[2];
  if (scale === "k" || scale === "thousand") amount *= 1_000;
  if (scale === "m" || scale === "mil" || scale === "million" || scale === "mn") amount *= 1_000_000;
  if (scale === "bn" || scale === "billion") amount *= 1_000_000_000;
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e12) return undefined;
  return String(Math.round(amount * 100));
}

/** Budget phrases: "under 2 million", "between 3k and 5k", "around 4,000", "max 5000". */
export function parseBudget(raw: string): { minMinor?: string; maxMinor?: string } {
  const value = normalize(raw).replace(/(\d),(?=\d{3}\b)/g, "$1");
  const between = value.match(/between (.+?) and (.+)/) ?? value.match(/from (.+?) to (.+)/) ?? value.match(/(\d[\d.]*\s*(?:k|m|million)?)\s*-\s*(\d[\d.]*\s*(?:k|m|million)?)/);
  if (between) {
    const min = parseMoneyMinor(between[1]);
    const max = parseMoneyMinor(between[2]);
    if (min && max && BigInt(min) <= BigInt(max)) return { minMinor: min, maxMinor: max };
  }
  const amount = parseMoneyMinor(value);
  if (!amount) return {};
  if (/\b(above|over|more than|at least|minimum|min|from)\b/.test(value)) return { minMinor: amount };
  if (/\b(around|about|approximately|roughly|circa|~)\b/.test(value)) {
    return { maxMinor: String(Math.round(Number(amount) * 1.15)) };
  }
  return { maxMinor: amount };
}

// ------------------------------------------------------------------------------------------------
// Locations (Ghana-first; anything unknown is kept as free text, never discarded)
// ------------------------------------------------------------------------------------------------

export const GHANA_REGIONS = [
  "Greater Accra", "Ashanti", "Western", "Western North", "Central", "Eastern", "Volta", "Oti", "Northern",
  "Savannah", "North East", "Upper East", "Upper West", "Bono", "Bono East", "Ahafo",
];

const CITIES: Record<string, string> = {
  Accra: "Greater Accra", Tema: "Greater Accra", Ashaiman: "Greater Accra", Madina: "Greater Accra", Adenta: "Greater Accra",
  Kasoa: "Central", "Cape Coast": "Central", Winneba: "Central",
  Kumasi: "Ashanti", Obuasi: "Ashanti", Ejisu: "Ashanti",
  Takoradi: "Western", Sekondi: "Western", Tarkwa: "Western",
  Tamale: "Northern", Ho: "Volta", Aflao: "Volta", Hohoe: "Volta", Koforidua: "Eastern", Nkawkaw: "Eastern", Aburi: "Eastern",
  Sunyani: "Bono", Techiman: "Bono East", Bolgatanga: "Upper East", Wa: "Upper West", Dambai: "Oti", Damongo: "Savannah",
  Nalerigu: "North East", Goaso: "Ahafo", "Sefwi Wiawso": "Western North",
};

/** Well-known neighbourhoods → city, so "East Legon" is understood as Accra. */
const NEIGHBOURHOODS: Record<string, string> = {
  "East Legon": "Accra", "West Legon": "Accra", "North Legon": "Accra", Legon: "Accra", Cantonments: "Accra", "Airport Residential": "Accra",
  Airport: "Accra", Osu: "Accra", Labone: "Accra", "Roman Ridge": "Accra", Ridge: "Accra", Dzorwulu: "Accra", Abelemkpe: "Accra",
  "Ashaley Botwe": "Accra", "Spintex": "Accra", Sakumono: "Tema", Lashibi: "Tema", Teshie: "Accra", Nungua: "Accra", Labadi: "Accra",
  "La": "Accra", Achimota: "Accra", Tesano: "Accra", "Kokomlemle": "Accra", "Asylum Down": "Accra", Dansoman: "Accra", Kaneshie: "Accra",
  Odorkor: "Accra", Mallam: "Accra", Weija: "Accra", "McCarthy Hill": "Accra", Gbawe: "Accra", Haatso: "Accra", Kwabenya: "Accra",
  Dome: "Accra", Taifa: "Accra", Ofankor: "Accra", Pokuase: "Accra", Amasaman: "Accra", Ashongman: "Accra", Oyarifa: "Accra",
  Abokobi: "Accra", Ogbojo: "Accra", Trasacco: "Accra", "Tse Addo": "Accra", Okponglo: "Accra", Shiashie: "Accra", Lapaz: "Accra",
  Abeka: "Accra", Kwashieman: "Accra", Mamprobi: "Accra", "Dworwulu": "Accra", Adjiringanor: "Accra", Kpone: "Tema",
  "Community 25": "Tema", "Community 18": "Tema", Dawhenya: "Tema", Prampram: "Tema", "Tema New Town": "Tema", Batsonaa: "Tema",
  Ahodwo: "Kumasi", Nhyiaeso: "Kumasi", Nhyiaesu: "Kumasi", Bantama: "Kumasi", Asokwa: "Kumasi", Adum: "Kumasi", Danyame: "Kumasi",
  Kwadaso: "Kumasi", Santasi: "Kumasi", Atonsu: "Kumasi", Ayeduase: "Kumasi", Bomso: "Kumasi", Kentinkrono: "Kumasi", Patasi: "Kumasi",
  Suame: "Kumasi", Tafo: "Kumasi", Ahinsan: "Kumasi", Anwomaso: "Kumasi",
};

export type ParsedLocation = { countryCode: "GH"; region?: string; city?: string; area?: string; label: string };

function titleCase(value: string) {
  return value.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}

function findKnown(value: string, names: string[]) {
  return names
    .filter((name) => new RegExp(`\\b${name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(value))
    .sort((a, b) => b.length - a.length)[0];
}

/**
 * Finds a location in a message. Known Ghanaian regions, cities and neighbourhoods are resolved;
 * otherwise the words after "in"/"at"/"around" are kept as a free-text area. `explicit` treats the
 * whole message as a location answer (the assistant just asked "Which area?").
 */
export function parseLocation(raw: string, explicit = false): ParsedLocation | undefined {
  const value = normalize(raw);
  const neighbourhood = findKnown(value, Object.keys(NEIGHBOURHOODS));
  const city = findKnown(value, Object.keys(CITIES));
  const region = findKnown(value.replace(/\bregion\b/g, ""), GHANA_REGIONS);
  if (neighbourhood) {
    const resolvedCity = city && city !== neighbourhood ? city : NEIGHBOURHOODS[neighbourhood];
    return { countryCode: "GH", area: neighbourhood, city: resolvedCity, region: CITIES[resolvedCity] ?? region, label: `${neighbourhood}, ${resolvedCity}` };
  }
  // "Greater Accra" contains "Accra": prefer the region reading when the region was named.
  if (region && (!city || region.toLowerCase().includes(city.toLowerCase()))) return { countryCode: "GH", region, label: `${region} Region` };
  if (city) return { countryCode: "GH", city, region: CITIES[city], label: city };
  const phrase = value.match(/\b(?:in|at|around|near|within|located in)\s+([\p{L}][\p{L}\s'.-]{1,60}?)(?=\s+(?:for|under|below|with|around|between|budget|within|at|that|which|and|max|from|to|area)\b|[,.]|$)/u)?.[1];
  const candidate = (phrase ?? (explicit ? value : undefined))?.replace(/\b(ghana|area|town|city|please|thanks?)\b/g, "").trim();
  if (!candidate || candidate.length < 2 || candidate.length > 60 || /\d{3,}/.test(candidate)) return undefined;
  if (!phrase && (PROPERTY_WORDS.test(candidate) || SERVICE_WORDS.test(candidate))) return undefined;
  return { countryCode: "GH", area: titleCase(candidate), label: titleCase(candidate) };
}

export type PropertyCriteria = {
  listingType?: ListingTypeValue;
  category?: string;
  bedrooms?: number;
  bathrooms?: number;
  furnishing?: "FURNISHED" | "SEMI_FURNISHED" | "UNFURNISHED";
  minBudgetMinor?: string;
  maxBudgetMinor?: string;
  location?: ParsedLocation;
};

/** Everything a single message says about a property search. Only fields actually stated. */
export function extractPropertyCriteria(raw: string): PropertyCriteria {
  const criteria: PropertyCriteria = {};
  const listingType = parseListingType(raw);
  if (listingType) criteria.listingType = listingType;
  const category = parseCategory(raw);
  if (category) criteria.category = category;
  const bedrooms = parseBedrooms(raw);
  if (bedrooms !== undefined) criteria.bedrooms = bedrooms;
  const bathrooms = parseBathrooms(raw);
  if (bathrooms !== undefined) criteria.bathrooms = bathrooms;
  const furnishing = parseFurnishing(raw);
  if (furnishing) criteria.furnishing = furnishing;
  const value = normalize(raw);
  if (/\b(ghs|gh₵|ghc|₵|cedis?|budget|under|below|less than|max|maximum|around|about|between|up to|k\b|million|\d+m\b)/.test(value)) {
    const budget = parseBudget(raw.replace(/\b\d+\s*[- ]?(bed(room)?s?|bath(room)?s?)\b/gi, ""));
    if (budget.minMinor) criteria.minBudgetMinor = budget.minMinor;
    if (budget.maxMinor) criteria.maxBudgetMinor = budget.maxMinor;
  }
  const location = parseLocation(raw);
  if (location) criteria.location = location;
  return criteria;
}

// ------------------------------------------------------------------------------------------------
// Generic answers
// ------------------------------------------------------------------------------------------------

export function parseYesNo(raw: string | undefined): boolean | undefined {
  if (!raw) return undefined;
  const value = normalize(raw);
  if (/^(y|yes|yeah|yep|yup|ok|okay|sure|correct|confirm|confirmed|right|that's right|thats right|go ahead|submit|1)\b/.test(value)) return true;
  if (/^(n|no|nope|nah|wrong|incorrect|not right|2)\b/.test(value)) return false;
  return undefined;
}

export function parseInteger(raw: string, min = 0, max = 1_000_000): number | undefined {
  const value = normalize(raw);
  const word = WORD_NUMBERS[value];
  const match = value.match(/-?\d+/);
  const number = word ?? (match ? Number(match[0]) : NaN);
  return Number.isInteger(number) && number >= min && number <= max ? number : undefined;
}

export function parseDecimal(raw: string, min = 0, max = 1_000_000): number | undefined {
  const match = normalize(raw).replace(/(\d),(?=\d{3}\b)/g, "$1").match(/\d+(?:\.\d+)?/);
  const number = match ? Number(match[0]) : NaN;
  return Number.isFinite(number) && number >= min && number <= max ? number : undefined;
}

/** "600 sqm", "2 acres", "1 hectare", "70x100 ft". Returns square metres. */
export function parseAreaSqm(raw: string): number | undefined {
  const value = normalize(raw).replace(/(\d),(?=\d{3}\b)/g, "$1");
  const dims = value.match(/(\d+(?:\.\d+)?)\s*(?:x|by|\*)\s*(\d+(?:\.\d+)?)\s*(ft|feet|foot|m|metres?|meters?)?/);
  if (dims) {
    const area = Number(dims[1]) * Number(dims[2]);
    const sqm = dims[3] && /^f/.test(dims[3]) ? area * 0.09290304 : area;
    return sqm > 0 ? Math.round(sqm * 100) / 100 : undefined;
  }
  const amount = parseDecimal(value, 0.0001, 1e9);
  if (amount === undefined) return undefined;
  if (/\bacres?\b/.test(value)) return Math.round(amount * 4046.8564224 * 100) / 100;
  if (/\b(hectares?|ha)\b/.test(value)) return Math.round(amount * 10_000 * 100) / 100;
  if (/\b(sq ?ft|square f(ee|oo)t|ft2)\b/.test(value)) return Math.round(amount * 0.09290304 * 100) / 100;
  if (/\b(sqm|m2|m²|square met(re|er)s?|sq m)\b/.test(value) || /^\d+(?:\.\d+)?$/.test(value)) return amount;
  return undefined;
}

export function parseEmail(raw: string): string | undefined {
  const match = raw.trim().match(/^[^\s@<>()]{1,64}@[^\s@<>()]{1,255}\.[A-Za-z]{2,24}$/);
  return match ? match[0].toLowerCase() : undefined;
}

export function parseList(raw: string, max = 20): string[] {
  return [...new Set(raw.split(/[,;\n]|\band\b/i).map((part) => part.trim().replace(/\s+/g, " ")).filter((part) => part.length >= 2 && part.length <= 80))].slice(0, max);
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * Parses a viewing time such as "tomorrow 10am", "Saturday at 2:30pm", "25/10 3pm",
 * "25 Oct 15:00" or "2026-10-25 15:00". Ghana uses GMT all year, so times are UTC. Returns
 * undefined when either the day or the time is missing — a viewing time is never guessed.
 */
export function parseDateTime(raw: string, now: Date): Date | undefined {
  const value = normalize(raw).replace(/\bnoon\b/, "12pm");
  const time = value.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)\b/) ?? value.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/);
  if (!time) return undefined;
  let hour = Number(time[1]);
  const minute = Number(time[2] ?? 0);
  const meridiem = time[3];
  if (meridiem) {
    if (hour < 1 || hour > 12) return undefined;
    if (meridiem === "pm" && hour !== 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
  }
  if (hour > 23 || minute > 59) return undefined;
  const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let day: Date | undefined;
  const iso = value.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  const numeric = value.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  const named = value.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTHS.join("|")})[a-z]*\\b`)) ?? value.match(new RegExp(`\\b(${MONTHS.join("|")})[a-z]*\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`));
  if (/\btoday\b/.test(value)) day = base;
  else if (/\btomorrow\b|\btmrw\b|\btmr\b/.test(value)) day = new Date(base.getTime() + 86_400_000);
  else if (iso) day = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
  else if (named) {
    const [dayText, monthText] = /^\d/.test(named[1]) ? [named[1], named[2]] : [named[2], named[1]];
    day = new Date(Date.UTC(now.getUTCFullYear(), MONTHS.indexOf(monthText.slice(0, 3)), Number(dayText)));
    if (day < base) day = new Date(Date.UTC(now.getUTCFullYear() + 1, MONTHS.indexOf(monthText.slice(0, 3)), Number(dayText)));
  } else if (numeric && numeric[0] !== time[0]) {
    const year = numeric[3] ? (numeric[3].length === 2 ? 2000 + Number(numeric[3]) : Number(numeric[3])) : now.getUTCFullYear();
    day = new Date(Date.UTC(year, Number(numeric[2]) - 1, Number(numeric[1])));
    if (!numeric[3] && day < base) day = new Date(Date.UTC(year + 1, Number(numeric[2]) - 1, Number(numeric[1])));
  } else {
    const weekday = WEEKDAYS.findIndex((name) => new RegExp(`\\b${name}\\b|\\b${name.slice(0, 3)}\\b`).test(value));
    if (weekday >= 0) {
      let delta = (weekday - base.getUTCDay() + 7) % 7;
      if (delta === 0 || /\bnext\b/.test(value)) delta += delta === 0 ? 7 : 0;
      day = new Date(base.getTime() + delta * 86_400_000);
    }
  }
  if (!day || Number.isNaN(day.getTime())) return undefined;
  return new Date(day.getTime() + (hour * 60 + minute) * 60_000);
}

/** "now", "immediately" or a date ("1 Nov", "2026-11-01", "01/11/2026"). Date at 00:00 UTC. */
export function parseAvailableFrom(raw: string, now: Date): Date | undefined {
  const value = normalize(raw);
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (/\b(now|immediately|today|available|asap|right away|ready)\b/.test(value)) return today;
  const parsed = parseDateTime(`${value} 00:00`, now);
  return parsed ? new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate())) : undefined;
}

/** Matches typed text against a list of options: by number ("2"), exact title or a unique word match. */
export function matchOption<T extends { id: string; title: string }>(raw: string | undefined, options: readonly T[]): T | undefined {
  if (!raw || !options.length) return undefined;
  const value = normalize(raw).replace(/[.!]+$/, "");
  const number = /^\d{1,2}$/.test(value) ? Number(value) : NaN;
  if (Number.isInteger(number) && number >= 1 && number <= options.length) return options[number - 1];
  const exact = options.find((option) => normalize(option.title) === value || option.id.toLowerCase() === value);
  if (exact) return exact;
  const partial = options.filter((option) => value.length >= 3 && normalize(option.title).includes(value));
  return partial.length === 1 ? partial[0] : undefined;
}
