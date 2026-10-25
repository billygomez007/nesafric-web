import { replyButtons, type WhatsAppInteractive } from "@/modules/conversations/channels/whatsapp-interactive";

/**
 * The official NesAfric number's welcome: a greeting for the time in Ghana, the customer's first
 * name when one is reliably known, a short welcome and a "Choose an option" list. Every option runs
 * a workflow that already exists; details are shown only after an option is chosen.
 */
const WELCOME = `🏡 Welcome to NesAfric!
Your smarter way to manage properties and explore real estate — all on WhatsApp.
Tap Choose an option below to get started, or simply tell me what you need.`;

/** Rows of the "Choose an option" list. Each id is a command the assistant already handles. */
const MENU = [
  { id: "find a property", title: "Find a Property", description: "Rent, buy, land, commercial or a viewing" },
  { id: "account", title: "Manage My Properties", description: "Your properties, tenancies and jobs (linked account)" },
  { id: "list a property", title: "List a Property" },
  { id: "register agent", title: "Register as an Agent" },
  { id: "register services", title: "Register Services", description: "Register a service business" },
  { id: "register", title: "Landlord / Prop. Manager", description: "Register as a landlord or property manager" },
  { id: "property services", title: "Find Property Services", description: "Verified service providers" },
  { id: "my applications", title: "My Applications", description: "Your registrations and listings" },
  { id: "support", title: "Help & Support", description: "Talk to the NesAfric team" },
  { id: "more options", title: "More options", description: "Agencies, agents, account linking, status" },
] as const;

/** Typed menu numbers, in the order of the list. */
export const OFFICIAL_MENU_COMMANDS: Record<string, string> = Object.fromEntries(MENU.slice(0, 9).map((row, index) => [String(index + 1), row.id]));

/** Words for the same options, so a typed reply and a tap take one path. */
export const OFFICIAL_ALIASES: Record<string, string> = {
  "find a property": "find a property", "find property": "find a property", "property": "find a property", "find a home": "find a property",
  "rent": "rent", "buy": "buy", "find property to rent": "rent", "find property to buy": "buy",
  "land": "land", "land and plots": "land", "land & plots": "land", "plots": "land",
  "commercial": "commercial", "commercial properties": "commercial", "commercial property": "commercial",
  "book a viewing": "book a viewing", "book viewing": "book a viewing", "viewing": "book a viewing",
  "find an agent": "find an agent", "find agent": "find an agent", "agents": "find an agent",
  "manage my properties": "account", "my properties": "account",
  "register as an agent": "register agent",
  "register a service business": "register services", "register service business": "register services",
  "find property services": "property services", "property services": "property services", "services": "property services",
  "help and support": "support", "help & support": "support",
  "back": "menu", "home": "menu", "main menu": "menu", "restart": "cancel", "start over": "cancel",
  "more options": "more options", "options": "more options",
};

export const MORE_OPTIONS = `More options:
• register agency: register a real estate agency or company
• find an agent: verified agents and agencies near you
• list my services: publish your service business's services
• link: connect this number to your NesAfric account
• status: your latest inquiry or viewing request

Reply menu to see the main options again.`;

const ACCRA_HOUR = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Accra", hour: "2-digit", hourCycle: "h23" });

/** Morning 05:00–11:59, afternoon 12:00–16:59, evening 17:00–04:59, Ghana time (Africa/Accra). */
export function ghanaGreeting(now: Date) {
  const hour = Number(ACCRA_HOUR.format(now));
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  return "Good evening";
}

const NOT_A_NAME = new Set(["whatsapp", "user", "customer", "client", "unknown", "null", "undefined", "none", "test", "nesafric", "admin", "me", "hi", "hello"]);

/**
 * A first name fit to greet someone with, or undefined. Only letters (with apostrophes and hyphens)
 * count: a phone number, an email, an emoji-only or placeholder profile name is never used.
 */
export function firstNameFrom(name: string | null | undefined) {
  const first = name?.normalize("NFC").trim().split(/\s+/)[0]?.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
  if (!first || !/^\p{L}[\p{L}\p{M}'’-]{1,29}$/u.test(first) || NOT_A_NAME.has(first.toLowerCase())) return undefined;
  return first === first.toLowerCase() || first === first.toUpperCase() ? first.charAt(0).toUpperCase() + first.slice(1).toLowerCase() : first;
}

export function greetingLine(now: Date, name?: string | null) {
  const first = firstNameFrom(name);
  return `${ghanaGreeting(now)}${first ? `, ${first}` : ""}! 🏡`;
}

/** The welcome as one list message: greeting and welcome as the body, "Choose an option" beneath. */
export function officialWelcomeList(greeting: string, prefix = "", suffix = ""): WhatsAppInteractive | undefined {
  const body = `${prefix}${greeting}\n\n${WELCOME}${suffix}`;
  if (body.length > 1024) return undefined;
  return { type: "list", body, button: "Choose an option", sections: [{ title: "How can we help?", rows: MENU.map((row) => ({ ...row })) }] };
}

/**
 * Stored text (transcript, staff inbox, and what a phone without list support shows): the same
 * welcome followed by the numbered options, which can also be typed.
 */
export function welcomeText(greeting: string, prefix = "", suffix = "") {
  const options = MENU.slice(0, 9).map((row, index) => `${index + 1}. ${row.title}`).join("\n");
  return `${prefix}${greeting}\n\n${WELCOME}\n\n${options}${suffix}`;
}

export function welcomeReply(greeting: string, prefix = "", suffix = "") {
  return { reply: welcomeText(greeting, prefix, suffix), interactive: officialWelcomeList(greeting, prefix, suffix) };
}

export const FIND_PROPERTY_PROMPT = "What are you looking for? Reply rent, buy, land, commercial, or book a viewing.";
export function findPropertyChoices(): WhatsAppInteractive {
  return {
    type: "list", body: FIND_PROPERTY_PROMPT, button: "Choose", sections: [{ rows: [
      { id: "rent", title: "Property to rent" },
      { id: "buy", title: "Property to buy" },
      { id: "land", title: "Land & plots" },
      { id: "commercial", title: "Commercial property", description: "Office, shop or warehouse" },
      { id: "book a viewing", title: "Book a viewing", description: "Find the property, then request a viewing" },
    ] }],
  };
}

// Words, not numbers: a bare number is always a main-menu choice.
export const COMMERCIAL_PROMPT = "Which kind of commercial property? Reply office, shop, warehouse or other commercial.";
export function commercialChoices(): WhatsAppInteractive {
  return {
    type: "list", body: COMMERCIAL_PROMPT, button: "Choose type", sections: [{ rows: [
      { id: "office", title: "Office" }, { id: "shop", title: "Shop" }, { id: "warehouse", title: "Warehouse" }, { id: "other commercial", title: "Other commercial" },
    ] }],
  };
}

/** A viewing is always for a listing found first; the request is confirmed by the listing team. */
export const VIEWING_PROMPT = "To book a viewing, first find the property. Viewings are requests: the listing team confirms the time.\nAre you looking to rent or buy?";
export const viewingButtons = () => replyButtons(VIEWING_PROMPT, [{ id: "rent", title: "Rent" }, { id: "buy", title: "Buy" }, { id: "menu", title: "Main menu" }]);

export const rentOrBuyButtons = (text: string) => replyButtons(text, [{ id: "rent", title: "Rent" }, { id: "buy", title: "Buy" }]);
