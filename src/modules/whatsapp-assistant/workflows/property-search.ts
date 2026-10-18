import { searchPublicListings } from "@/modules/listings/service";
import { isBookableCategory } from "@/lib/listing-categories";
import type { Ctx, StartSeed, Workflow } from "../context";
import { coverImageUrl, listingCard, moneyText, type PublicListingCard } from "../format";
import { categoryLabel, detectCommand, extractPropertyCriteria, isResidentialCategory, parseBudget, parseListingType, parseLocation, type PropertyCriteria } from "../nlu";
import { recordEvent } from "../store";
import { errorLabel } from "../log";

const PAGE_SIZE = 3;

type Data = { criteria: PropertyCriteria; anyLocation?: boolean; askedBudget?: boolean; page?: number; total?: number; resultIds?: string[] };

function merge(into: PropertyCriteria, from: PropertyCriteria) {
  for (const [key, value] of Object.entries(from)) if (value !== undefined) (into as Record<string, unknown>)[key] = value;
  return into;
}

export function describeCriteria(criteria: PropertyCriteria) {
  const parts: string[] = [];
  if (criteria.bedrooms !== undefined && isResidentialCategory(criteria.category ?? "HOUSE")) parts.push(criteria.bedrooms === 0 ? "studio" : `${criteria.bedrooms}-bedroom`);
  if (criteria.furnishing) parts.push(criteria.furnishing.toLowerCase().replace("_", "-"));
  parts.push(criteria.category ? `${categoryLabel(criteria.category).toLowerCase()}s` : "properties");
  parts.push(criteria.listingType === "SALE" ? "for sale" : criteria.listingType === "RENT" ? "for rent" : "");
  if (criteria.location) parts.push(`in ${criteria.location.label}`);
  if (criteria.maxBudgetMinor && criteria.minBudgetMinor) parts.push(`between ${moneyText(criteria.minBudgetMinor)} and ${moneyText(criteria.maxBudgetMinor)}`);
  else if (criteria.maxBudgetMinor) parts.push(`up to ${moneyText(criteria.maxBudgetMinor)}`);
  else if (criteria.minBudgetMinor) parts.push(`from ${moneyText(criteria.minBudgetMinor)}`);
  return parts.filter(Boolean).join(" ");
}

/** Translates collected criteria into the public listing search the website uses. */
export function searchQuery(criteria: PropertyCriteria, page: number) {
  const location = criteria.location;
  const query: Record<string, unknown> = { page, pageSize: PAGE_SIZE };
  if (criteria.listingType) query.listingType = criteria.listingType;
  if (criteria.category) query.category = criteria.category;
  if (criteria.bedrooms !== undefined && isResidentialCategory(criteria.category ?? "HOUSE")) {
    query.bedroomsMin = criteria.bedrooms;
    query.bedroomsMax = criteria.bedrooms;
  }
  if (criteria.bathrooms !== undefined) query.bathroomsMin = criteria.bathrooms;
  if (criteria.furnishing) query.furnishing = criteria.furnishing;
  if (criteria.minBudgetMinor || criteria.maxBudgetMinor) query.currencyCode = "GHS";
  if (criteria.minBudgetMinor) query.minPriceMinor = criteria.minBudgetMinor;
  if (criteria.maxBudgetMinor) query.maxPriceMinor = criteria.maxBudgetMinor;
  if (location) {
    query.country = location.countryCode;
    if (location.area) query.area = location.area;
    else if (location.city) query.area = location.city;
    else if (location.region) query.region = location.region;
  }
  return query;
}

async function askNext(ctx: Ctx): Promise<boolean> {
  const data = ctx.data<Data>();
  const criteria = data.criteria;
  if (!criteria.listingType && !(criteria.category && isBookableCategory(criteria.category))) {
    ctx.step("listingType");
    ctx.ask(`Are you looking to rent or buy${criteria.category ? ` a ${categoryLabel(criteria.category).toLowerCase()}` : ""}?`, [
      { id: "ps:type:RENT", title: "Rent" },
      { id: "ps:type:SALE", title: "Buy" },
    ]);
    return true;
  }
  if (!criteria.location && !data.anyLocation) {
    ctx.step("location");
    ctx.prompt("Which area or city? For example: *East Legon*, *Kumasi* or *Spintex, Accra*. Reply *any* to search everywhere.");
    return true;
  }
  if (!criteria.maxBudgetMinor && !criteria.minBudgetMinor && !data.askedBudget) {
    data.askedBudget = true;
    ctx.step("budget");
    ctx.prompt(criteria.listingType === "SALE"
      ? "What is your budget? For example: *under GHS 2 million*. Reply *skip* for any price."
      : "What is your budget? For example: *GHS 4,000 a month*. Reply *skip* for any price.");
    return true;
  }
  return false;
}

async function runSearch(ctx: Ctx, page = 1) {
  const data = ctx.data<Data>();
  data.page = page;
  if (isBookableCategory(data.criteria.category) && !data.criteria.listingType) data.criteria.listingType = "RENT";
  let result: Awaited<ReturnType<typeof searchPublicListings>>;
  try {
    result = await searchPublicListings(searchQuery(data.criteria, page));
  } catch (error) {
    // A technical failure is never presented as "no properties".
    console.error("[whatsapp-assistant] property search failed", { error: errorLabel(error) });
    await recordEvent("property_search_error", ctx.contact.id, {});
    ctx.step("results");
    ctx.ask("Sorry — I couldn't reach our listings just now. That's a problem on our side, not a lack of properties. Please try again in a moment.", [
      { id: "ps:retry", title: "Try again" },
      { id: "menu", title: "Main menu" },
    ]);
    return;
  }
  const items = result.items as unknown as PublicListingCard[];
  data.total = result.pagination.total;
  data.resultIds = items.map(({ id }) => id);
  await recordEvent("property_search", ctx.contact.id, { results: result.pagination.total, page, listingType: data.criteria.listingType ?? null, category: data.criteria.category ?? null, location: data.criteria.location?.label ?? null });
  ctx.step("results");

  if (!items.length) {
    if (page === 1) await recordEvent("property_search_zero", ctx.contact.id, { location: data.criteria.location?.label ?? null });
    const options = [
      ...(data.criteria.location?.area ? [{ id: "ps:widen", title: data.criteria.location.city ? `All of ${data.criteria.location.city}` : "Search everywhere" }] : data.criteria.location ? [{ id: "ps:widen", title: "Search everywhere" }] : []),
      ...(data.criteria.maxBudgetMinor || data.criteria.minBudgetMinor ? [{ id: "ps:nobudget", title: "Any price" }] : []),
      ...(data.criteria.bedrooms !== undefined || data.criteria.furnishing ? [{ id: "ps:relax", title: "Fewer filters" }] : []),
      { id: "ps:new", title: "New search" },
      { id: "menu", title: "Main menu" },
    ];
    ctx.ask(page === 1
      ? `I couldn't find any verified, published ${describeCriteria(data.criteria)} on NesAfric right now. Would you like to broaden the search?`
      : "That's all the matching properties for now.", options);
    return;
  }

  const firstIndex = (page - 1) * PAGE_SIZE;
  if (page === 1) ctx.say(`I found ${result.pagination.total} ${result.pagination.total === 1 ? "property" : "properties"} matching ${describeCriteria(data.criteria)}:`);
  items.forEach((item, offset) => {
    const card = listingCard(item, firstIndex + offset + 1, ctx.now);
    const image = coverImageUrl(item);
    ctx.say(image ? { kind: "image", url: image, caption: card } : card);
  });
  const options = [
    ...items.map((item, offset) => ({ id: `ps:ask:${item.id}`, title: `Ask about #${firstIndex + offset + 1}`, description: item.title })),
    ...items.filter((item) => !isBookableCategory(item.category)).map((item) => ({ id: `ps:view:${item.id}`, title: `View #${items.indexOf(item) + firstIndex + 1}`, description: `Request a viewing: ${item.title}` })),
    ...(result.pagination.page < result.pagination.totalPages ? [{ id: "ps:more", title: "See more properties" }] : []),
    { id: "ps:new", title: "New search" },
  ];
  for (const pending of ctx.state.pendingIntents ?? []) {
    if (options.length < 10 && pending.intent === "service_search") options.push({ id: "ps:pending:service_search", title: "Find a service pro" });
  }
  ctx.ask("What would you like to do next?", options.slice(0, 10), "Options");
}

async function proceed(ctx: Ctx) {
  if (!(await askNext(ctx))) await runSearch(ctx, 1);
}

export const propertySearch: Workflow = {
  key: "property_search",

  async start(ctx: Ctx, seed: StartSeed) {
    if (seed.preset === "resume-results" && ctx.data<Data>().criteria) {
      ctx.state.workflow = "property_search";
      return runSearch(ctx, ctx.data<Data>().page ?? 1);
    }
    const criteria = seed.text ? extractPropertyCriteria(seed.text) : {};
    ctx.go("property_search", "listingType", { criteria } satisfies Data);
    const summary = describeCriteria(criteria);
    if (seed.text && (criteria.category || criteria.location || criteria.listingType)) ctx.say(`Great — let's find ${summary}.`);
    await proceed(ctx);
  },

  async handle(ctx: Ctx) {
    const data = ctx.data<Data>();
    const choice = ctx.choice;
    if (choice === "ps:new") return propertySearch.start(ctx, {});
    if (choice === "ps:retry") return runSearch(ctx, data.page ?? 1);
    if (choice === "ps:more" || (ctx.state.step === "results" && detectCommand(ctx.text) === "more")) return runSearch(ctx, (data.page ?? 1) + 1);
    if (choice === "ps:widen") {
      const location = data.criteria.location;
      data.criteria.location = location?.area && location.city ? { countryCode: "GH", city: location.city, region: location.region, label: location.city } : undefined;
      data.anyLocation = !data.criteria.location;
      return runSearch(ctx, 1);
    }
    if (choice === "ps:nobudget") {
      delete data.criteria.maxBudgetMinor;
      delete data.criteria.minBudgetMinor;
      return runSearch(ctx, 1);
    }
    if (choice === "ps:relax") {
      delete data.criteria.bedrooms;
      delete data.criteria.bathrooms;
      delete data.criteria.furnishing;
      return runSearch(ctx, 1);
    }
    if (choice?.startsWith("ps:ask:") || choice?.startsWith("ps:view:")) {
      const [, mode, listingId] = choice.split(":");
      ctx.handoff = { workflow: "property_inquiry", seed: { preset: `${mode === "ask" ? "inquiry" : "viewing"}:${listingId}` } };
      return;
    }
    if (choice === "ps:pending:service_search") {
      const pending = ctx.state.pendingIntents?.find((item) => item.intent === "service_search");
      ctx.state.pendingIntents = ctx.state.pendingIntents?.filter((item) => item !== pending);
      ctx.handoff = { workflow: "service_search", seed: { text: pending?.text } };
      return;
    }

    switch (ctx.state.step) {
      case "listingType": {
        const type = choice?.startsWith("ps:type:") ? choice.slice("ps:type:".length) as "RENT" | "SALE" : parseListingType(ctx.text);
        if (!type) return propertySearch.reprompt(ctx);
        // Anything else said in the same answer ("rent, in Adenta") is used too.
        merge(data.criteria, { ...extractPropertyCriteria(ctx.text), listingType: type });
        return proceed(ctx);
      }
      case "location": {
        if (/^(any|anywhere|everywhere|all|any area|skip)$/i.test(ctx.text)) {
          data.criteria.location = undefined;
          data.anyLocation = true;
          return proceed(ctx);
        }
        const extra = extractPropertyCriteria(ctx.text);
        const location = extra.location ?? parseLocation(ctx.text, true);
        if (!location) return propertySearch.reprompt(ctx);
        merge(data.criteria, { ...extra, location });
        return proceed(ctx);
      }
      case "budget": {
        if (detectCommand(ctx.text) !== "skip") {
          const budget = parseBudget(ctx.text);
          if (!budget.maxMinor && !budget.minMinor) {
            ctx.prompt("Sorry, I didn't catch an amount. Please reply with a number such as *4000*, *4k* or *2 million*, or *skip*.");
            return;
          }
          data.criteria.minBudgetMinor = budget.minMinor;
          data.criteria.maxBudgetMinor = budget.maxMinor;
        }
        return runSearch(ctx, 1);
      }
      case "results": {
        // A new description ("3 bedroom in Kumasi instead") refines the search.
        const refinement = extractPropertyCriteria(ctx.text);
        if (Object.keys(refinement).length) {
          merge(data.criteria, refinement);
          return runSearch(ctx, 1);
        }
        return propertySearch.reprompt(ctx);
      }
      default:
        return proceed(ctx);
    }
  },

  async reprompt(ctx: Ctx) {
    const step = ctx.state.step;
    if (step === "results") {
      ctx.ask("Please choose an option, or describe what you're looking for (e.g. *3 bedroom house in Kumasi*).", [
        ...((ctx.data<Data>().resultIds ?? []).map((id, index) => ({ id: `ps:ask:${id}`, title: `Ask about #${(((ctx.data<Data>().page ?? 1) - 1) * PAGE_SIZE) + index + 1}` }))),
        { id: "ps:new", title: "New search" },
        { id: "menu", title: "Main menu" },
      ]);
      return;
    }
    if (step === "location") {
      ctx.prompt("Which area or city should I search? For example *Adenta*, *Tema* or *Kumasi* — or reply *any*.");
      return;
    }
    if (step === "budget") {
      ctx.prompt("What's your budget? Reply with an amount like *5000* or *1.5 million*, or *skip*.");
      return;
    }
    if (step === "listingType") ctx.say("Please choose *Rent* or *Buy*.");
    await proceed(ctx);
  },
};
