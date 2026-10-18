import { createMarketplaceEnquiry, discoverMarketplaceProviders, getPublicMarketplaceProvider } from "@/modules/marketplace/service";
import { AppError } from "@/platform/errors";
import { runOnce } from "../actions";
import type { Ctx, StartSeed, Workflow } from "../context";
import { providerCard, providerUrl, type PublicProviderCard } from "../format";
import { ensureUserForContact } from "../identity";
import { detectCommand, parseLocation, parseYesNo, type ParsedLocation } from "../nlu";
import { referenceFor } from "../references";
import { matchServiceCategory, POPULAR_CATEGORY_KEYS, publicServiceCategories, type ServiceCategoryOption } from "../service-categories";
import { deliverWhatsAppNotificationNow, enqueueWhatsAppNotificationInTx, type WhatsAppNotificationJob } from "../notification-outbox";
import { recordEvent, recordEventInTx } from "../store";
import { errorLabel } from "../log";

const PAGE_SIZE = 3;

type SearchData = {
  category?: Pick<ServiceCategoryOption, "id" | "key" | "name">;
  location?: ParsedLocation;
  anyLocation?: boolean;
  details?: string;
  askedDetails?: boolean;
  page?: number;
  resultIds?: string[];
};

type ProviderCard = PublicProviderCard & { acceptingWork: boolean };

/** Whether NesAfric's enquiry service will accept a request for this provider right now. */
export const canRequestQuote = (provider: Pick<ProviderCard, "verification" | "acceptingWork" | "availability">) =>
  provider.verification === "VERIFIED" && provider.acceptingWork && provider.availability !== "UNAVAILABLE";

async function askCategory(ctx: Ctx, intro?: string) {
  const categories = await publicServiceCategories();
  const popular = POPULAR_CATEGORY_KEYS.map((key) => categories.find((category) => category.key === key)).filter(Boolean) as ServiceCategoryOption[];
  ctx.step("category");
  ctx.ask(`${intro ?? "What kind of service do you need?"} Choose one, or just describe it (e.g. *my sink is leaking*).`, popular.slice(0, 9).map((category) => ({ id: `ss:cat:${category.id}`, title: category.name })), "Services");
}

function searchQuery(data: SearchData, page: number) {
  const query: Record<string, unknown> = { category: data.category!.key, page, pageSize: PAGE_SIZE };
  if (data.location) {
    query.country = data.location.countryCode;
    if (data.location.region) query.region = data.location.region;
    if (data.location.city) query.city = data.location.city;
    if (data.location.area) query.district = data.location.area;
  }
  return query;
}

async function runSearch(ctx: Ctx, page = 1) {
  const data = ctx.data<SearchData>();
  data.page = page;
  ctx.step("results");
  let result: Awaited<ReturnType<typeof discoverMarketplaceProviders>>;
  try {
    result = await discoverMarketplaceProviders(searchQuery(data, page));
  } catch (error) {
    console.error("[whatsapp-assistant] provider search failed", { error: errorLabel(error) });
    await recordEvent("service_search_error", ctx.contact.id, {});
    ctx.ask("Sorry — I couldn't reach our service directory just now. That's a problem on our side. Please try again shortly.", [{ id: "ss:retry", title: "Try again" }, { id: "menu", title: "Main menu" }]);
    return;
  }
  const items = result.items as unknown as ProviderCard[];
  data.resultIds = items.map(({ id }) => id);
  await recordEvent("service_search", ctx.contact.id, { results: result.pagination.total, page, category: data.category!.key, location: data.location?.label ?? null });
  const where = data.location ? ` in ${data.location.label}` : "";
  if (!items.length) {
    if (page === 1) await recordEvent("service_search_zero", ctx.contact.id, { category: data.category!.key, location: data.location?.label ?? null });
    ctx.ask(page === 1
      ? `I couldn't find any ${data.category!.name.toLowerCase()} providers serving${where || " your area"} on NesAfric yet.`
      : "That's all the matching providers for now.", [
      ...(data.location?.area ? [{ id: "ss:widen", title: data.location.city ? `All of ${data.location.city}` : "Search everywhere" }] : data.location ? [{ id: "ss:widen", title: "Search everywhere" }] : []),
      { id: "ss:newcat", title: "Different service" },
      { id: "menu", title: "Main menu" },
    ]);
    return;
  }
  const firstIndex = (page - 1) * PAGE_SIZE;
  if (page === 1) ctx.say(`Here ${result.pagination.total === 1 ? "is 1 provider" : `are ${result.pagination.total} providers`} for *${data.category!.name}*${where}:`);
  items.forEach((item, offset) => ctx.say(providerCard(item, firstIndex + offset + 1)));
  const quotable = items.filter(canRequestQuote);
  if (quotable.length < items.length) ctx.say("Providers not yet verified or not taking work can't receive requests through NesAfric yet — you can still view their profiles.");
  ctx.ask("What would you like to do?", [
    ...quotable.map((item) => ({ id: `ss:quote:${item.id}`, title: `Request quote #${items.indexOf(item) + firstIndex + 1}`, description: item.displayName })),
    ...(result.pagination.page < result.pagination.totalPages ? [{ id: "ss:more", title: "See more providers" }] : []),
    { id: "ss:newcat", title: "Different service" },
    { id: "menu", title: "Main menu" },
  ].slice(0, 10), "Options");
}

async function proceed(ctx: Ctx) {
  const data = ctx.data<SearchData>();
  if (!data.category) return askCategory(ctx);
  if (!data.location && !data.anyLocation) {
    ctx.step("location");
    ctx.prompt(`Which area do you need the ${data.category.name.toLowerCase()} in? e.g. *Spintex, Accra* or *Kumasi*. Reply *any* for anywhere.`);
    return;
  }
  if (!data.details && !data.askedDetails) {
    data.askedDetails = true;
    ctx.step("details");
    ctx.prompt("Briefly, what do you need done? (e.g. *bathroom pipe is leaking*). Reply *skip* to just see providers.");
    return;
  }
  return runSearch(ctx, 1);
}

export const serviceSearch: Workflow = {
  key: "service_search",

  async start(ctx: Ctx, seed: StartSeed) {
    const data: SearchData = {};
    if (seed.text) {
      const categories = await publicServiceCategories();
      const category = matchServiceCategory(seed.text, categories);
      if (category) data.category = { id: category.id, key: category.key, name: category.name };
      const location = parseLocation(seed.text);
      if (location) data.location = location;
      if (category && seed.text.split(/\s+/).length >= 5) data.details = seed.text.slice(0, 1000);
    }
    ctx.go("service_search", "category", data);
    if (data.category) ctx.say(`Sure — I'll look for *${data.category.name}*${data.location ? ` in ${data.location.label}` : ""}.`);
    return proceed(ctx);
  },

  async handle(ctx: Ctx) {
    const data = ctx.data<SearchData>();
    const choice = ctx.choice;
    if (choice === "ss:retry") return runSearch(ctx, data.page ?? 1);
    if (choice === "ss:more" || (ctx.state.step === "results" && detectCommand(ctx.text) === "more")) return runSearch(ctx, (data.page ?? 1) + 1);
    if (choice === "ss:newcat") {
      data.category = undefined;
      return askCategory(ctx);
    }
    if (choice === "ss:widen") {
      const location = data.location;
      data.location = location?.area && location.city ? { countryCode: "GH", city: location.city, region: location.region, label: location.city } : undefined;
      data.anyLocation = !data.location;
      return runSearch(ctx, 1);
    }
    if (choice?.startsWith("ss:quote:")) {
      ctx.handoff = { workflow: "service_quote", seed: { preset: `${choice.slice("ss:quote:".length)}:${data.category!.id}`, text: data.details } };
      return;
    }
    switch (ctx.state.step) {
      case "category": {
        const categories = await publicServiceCategories();
        const category = choice?.startsWith("ss:cat:")
          ? categories.find(({ id }) => id === choice.slice("ss:cat:".length))
          : matchServiceCategory(ctx.text, categories);
        if (!category) return askCategory(ctx, "Sorry, I couldn't match that to a service we list.");
        data.category = { id: category.id, key: category.key, name: category.name };
        if (!choice && ctx.text.split(/\s+/).length >= 4) data.details = ctx.text.slice(0, 1000);
        data.location ??= parseLocation(ctx.text);
        return proceed(ctx);
      }
      case "location": {
        if (/^(any|anywhere|everywhere|all|skip)$/i.test(ctx.text)) {
          data.anyLocation = true;
          return proceed(ctx);
        }
        const location = parseLocation(ctx.text, true);
        if (!location) return serviceSearch.reprompt(ctx);
        data.location = location;
        return proceed(ctx);
      }
      case "details": {
        if (detectCommand(ctx.text) !== "skip" && ctx.text) data.details = ctx.text.slice(0, 1000);
        return runSearch(ctx, 1);
      }
      default:
        return serviceSearch.reprompt(ctx);
    }
  },

  async reprompt(ctx: Ctx) {
    const data = ctx.data<SearchData>();
    if (ctx.state.step === "results" && data.category) {
      ctx.ask("Please choose an option below.", [{ id: "ss:newcat", title: "Different service" }, { id: "menu", title: "Main menu" }]);
      return;
    }
    if (ctx.state.step === "location") ctx.say("Please tell me the area or city, e.g. *Spintex* or *Kumasi*, or reply *any*.");
    return proceed(ctx);
  },
};

// ------------------------------------------------------------------------------------------------
// Quote / service request to one provider
// ------------------------------------------------------------------------------------------------

type QuoteData = { providerId: string; providerName: string; categoryId: string; details?: string; name?: string; search?: SearchData };

async function confirmQuote(ctx: Ctx) {
  const data = ctx.data<QuoteData>();
  ctx.step("confirm");
  ctx.ask(`Send this request to *${data.providerName}*?\n\n"${data.details}"\n\nThey'll see your name and WhatsApp number so they can reply.`, [
    { id: "sq:send", title: "Send request" },
    { id: "sq:edit", title: "Change details" },
    { id: "menu", title: "Cancel" },
  ]);
}

async function sendQuote(ctx: Ctx) {
  const data = ctx.data<QuoteData>();
  const { user } = await ensureUserForContact(ctx.contact, data.name ?? ctx.contact.profileName ?? "");
  // The request, its event, the provider's WhatsApp notification (outbox) and the action binding
  // commit together; a retry returns this exact request.
  const outcome = await runOnce(ctx.actionKey("service_enquiry"), ctx.contact.id, "service_enquiry", (bind) => createMarketplaceEnquiry(user.id, null, {
    providerId: data.providerId,
    categoryId: data.categoryId,
    message: `${data.details}\n\n(Sent via NesAfric WhatsApp)`,
  }, {
    inTransaction: bind(async (tx, enquiryId) => {
      await recordEventInTx(tx, "service_quote_requested", ctx.contact.id, { providerId: data.providerId });
      await enqueueWhatsAppNotificationInTx(tx, providerEnquiryJob(enquiryId));
    }),
  }));
  if (!outcome.repeated) await deliverWhatsAppNotificationNow(providerEnquiryJob(outcome.resultId));
  ctx.say(`✅ Your request has been sent to *${data.providerName}*.\nReference: ${referenceFor("QT", outcome.resultId)}\n\nNesAfric doesn't set their prices — they'll reply with availability and a quote. Reply *status* anytime to check.`);
  ctx.finish();
}

/** Tells the provider on WhatsApp too, when their account is linked to a WhatsApp contact. */
const providerEnquiryJob = (enquiryId: string): WhatsAppNotificationJob => ({ kind: "provider_enquiry", enquiryId, decisionKey: enquiryId });

export const serviceQuote: Workflow = {
  key: "service_quote",

  async start(ctx: Ctx, seed: StartSeed) {
    const [providerId, categoryId] = (seed.preset ?? "").split(":");
    const search = ctx.state.workflow === "service_search" ? { ...ctx.state.data } as SearchData : undefined;
    let provider: ProviderCard | null = null;
    try {
      provider = (await getPublicMarketplaceProvider(providerId)).provider as unknown as ProviderCard;
    } catch (error) {
      if (!(error instanceof AppError && error.status === 404)) throw error;
    }
    if (!provider || !canRequestQuote(provider)) {
      ctx.say(`Sorry — that provider can't receive requests through NesAfric right now.${provider ? ` You can view their profile: ${providerUrl(provider)}` : ""}`);
      ctx.finish();
      return;
    }
    ctx.go("service_quote", "details", { providerId, providerName: provider.displayName, categoryId, details: seed.text, search } satisfies QuoteData);
    if (!seed.text) {
      ctx.prompt(`Describe the job for *${provider.displayName}* — what needs doing, where, and when you'd like it done.`);
      return;
    }
    return serviceQuote.handle(ctx);
  },

  async handle(ctx: Ctx) {
    const data = ctx.data<QuoteData>();
    const choice = ctx.choice;
    if (choice === "sq:edit") {
      data.details = undefined;
      ctx.step("details");
      ctx.prompt("Please describe the job again.");
      return;
    }
    if (choice === "sq:send" || (ctx.state.step === "confirm" && parseYesNo(ctx.text) === true)) {
      if (!ctx.contact.userId && !data.name) {
        ctx.step("name");
        const profile = ctx.contact.profileName?.trim();
        ctx.prompt("What name should the provider use for you?", "text", profile && profile.length >= 2 ? [{ id: "sq:name:profile", title: `Use "${profile.slice(0, 14)}"` }] : undefined);
        return;
      }
      return sendQuote(ctx);
    }
    switch (ctx.state.step) {
      case "details": {
        const details = data.details ?? ctx.text;
        if (!details || details.length < 5) {
          ctx.prompt("Please describe the job in a few words, e.g. *fix leaking kitchen tap in Spintex this week*.");
          return;
        }
        data.details = details.slice(0, 2000);
        return confirmQuote(ctx);
      }
      case "name": {
        const name = choice === "sq:name:profile" ? ctx.contact.profileName?.trim() : ctx.text;
        if (!name || name.length < 2 || name.length > 160) {
          ctx.prompt("Please reply with your name.");
          return;
        }
        data.name = name;
        return sendQuote(ctx);
      }
      default:
        return serviceQuote.reprompt(ctx);
    }
  },

  async reprompt(ctx: Ctx) {
    if (ctx.state.step === "confirm") return confirmQuote(ctx);
    if (ctx.state.step === "name") {
      ctx.prompt("Please reply with your name.");
      return;
    }
    ctx.prompt("Please describe the job you need done.");
  },
};
