import { createMarketplaceLead, createViewingRequest, getPublicListing } from "@/modules/listings/service";
import { isBookableCategory } from "@/lib/listing-categories";
import { db } from "@/platform/database/client";
import { AppError } from "@/platform/errors";
import { boundActions, runOnce } from "../actions";
import type { Ctx, StartSeed, Workflow } from "../context";
import { availabilityText, dateTimeText, listingCard, priceText, propertyUrl, type PublicListingCard } from "../format";
import { categoryLabel, detectCommand, normalize, parseDateTime, parseYesNo } from "../nlu";
import { referenceFor } from "../references";
import { recordEventInTx } from "../store";

type Mode = "inquiry" | "viewing";
type Data = { listingId: string; title?: string; mode: Mode; question?: string; name?: string; startsAt?: string };

type PublicListing = PublicListingCard & { amenities: Array<{ key: string; label: string }>; bookable: boolean; contact: { enquiryEnabled: boolean } };

async function loadListing(listingId: string): Promise<PublicListing | null> {
  try {
    return (await getPublicListing(listingId)).listing as unknown as PublicListing;
  } catch (error) {
    if (error instanceof AppError && error.status === 404) return null;
    throw error;
  }
}

/**
 * Answers common questions from the listing's own published record only. Anything not on the
 * record is stated as unknown and offered to the agent — never guessed.
 */
export function answerFromListing(question: string, listing: PublicListing, now: Date): string | null {
  const value = normalize(question);
  const facts: string[] = [];
  if (/\b(price|cost|how much|rent|amount|fee|charge)\b/.test(value)) facts.push(`The listed price is ${priceText(listing.listingType, listing.pricing)}.`);
  if (/\b(bed(room)?s?|rooms?)\b/.test(value)) facts.push(listing.attributes.bedrooms !== null ? `It has ${listing.attributes.bedrooms === 0 ? "a studio layout" : `${listing.attributes.bedrooms} bedroom${listing.attributes.bedrooms === 1 ? "" : "s"}`}.` : "The number of bedrooms isn't listed.");
  if (/\b(bath(room)?s?|toilets?|washrooms?)\b/.test(value)) facts.push(listing.attributes.bathrooms !== null ? `It has ${Number(listing.attributes.bathrooms)} bathroom${Number(listing.attributes.bathrooms) === 1 ? "" : "s"}.` : "The number of bathrooms isn't listed.");
  if (/\b(size|big|sqm|square|plot|area)\b/.test(value)) facts.push(listing.attributes.sizeSqm ? `The listed size is ${Number(listing.attributes.sizeSqm).toLocaleString("en")} m².` : "The size isn't listed.");
  if (/\b(where|location|located|address|area|neighbou?rhood)\b/.test(value)) facts.push(`It's listed in ${listing.location.label ?? [listing.location.locality, listing.location.district, listing.location.city].filter(Boolean).join(", ")}. The exact address is shared by the agent.`);
  if (/\b(available|availability|when|move in|vacant)\b/.test(value)) facts.push(`${availabilityText(listing.availability.availableFrom, now)}.`);
  const amenityWords = value.match(/\b(parking|pool|swimming|security|cctv|generator|backup|water|borehole|gym|garden|balcony|furnished|air ?con\w*|internet|wifi|elevator|lift|gated|kitchen|garage)\b/g);
  for (const word of amenityWords ?? []) {
    const match = listing.amenities.find(({ label, key }) => normalize(label).includes(word.replace(/\s/g, "")) || key.includes(word.replace(/\s/g, "")) || normalize(label).includes(word));
    facts.push(match ? `Yes — "${match.label}" is listed.` : `"${word}" isn't listed, so I can't confirm it.`);
  }
  return facts.length ? [...new Set(facts)].join("\n") : null;
}


/** The lead this contact already created for this listing via WhatsApp, if still open. */
async function existingLead(contactId: string, listingId: string) {
  const actions = await boundActions(contactId, ["lead"], 50);
  if (!actions.length) return null;
  return db.marketplaceLead.findFirst({
    where: { id: { in: actions.map(({ resultId }) => resultId) }, listingId, status: { notIn: ["CLOSED", "LOST"] } },
    orderBy: { createdAt: "desc" },
  });
}

/** The lead, its owner's email notification, its event and the action binding commit together. */
async function createLead(ctx: Ctx, data: Data, message: string, event: { name: string; properties: Record<string, unknown> } | null) {
  return runOnce(ctx.actionKey("lead"), ctx.contact.id, "lead", (bind) => createMarketplaceLead(data.listingId, ctx.contact.userId ?? undefined, {
    name: data.name!,
    phone: ctx.contact.phoneE164 ?? `+${ctx.contact.waId}`,
    message: message.slice(0, 5000),
    source: "whatsapp",
    marketingConsent: false,
  }, { inTransaction: bind(event ? (tx) => recordEventInTx(tx, event.name, ctx.contact.id, event.properties) : undefined) }));
}

function askName(ctx: Ctx) {
  ctx.step("name");
  const profile = ctx.contact.profileName?.trim();
  ctx.prompt("What name should the agent use for you?", "text", profile && profile.length >= 2 ? [{ id: "pi:name:profile", title: `Use "${profile.slice(0, 14)}"` }] : undefined);
}

async function submitInquiry(ctx: Ctx) {
  const data = ctx.data<Data>();
  const outcome = await createLead(ctx, data, data.question ?? "Inquiry sent from NesAfric WhatsApp.", { name: "property_inquiry_created", properties: { listingId: data.listingId } });
  ctx.say(`✅ Your question about *${data.title}* has been passed to the listing's agent.\nReference: ${referenceFor("IQ", outcome.resultId)}\n\nThey'll reply to you on this WhatsApp number. Your number is shared only with this listing's agent.`);
  ctx.ask("Would you also like to request a viewing?", [
    { id: `pi:viewing:${data.listingId}`, title: "Request a viewing" },
    { id: "pi:back", title: "Back to results" },
    { id: "menu", title: "Main menu" },
  ]);
  ctx.step("after");
}

async function submitViewing(ctx: Ctx) {
  const data = ctx.data<Data>();
  let lead = await existingLead(ctx.contact.id, data.listingId);
  if (!lead) {
    const outcome = await createLead(ctx, data, "Viewing request sent from NesAfric WhatsApp.", null);
    lead = await db.marketplaceLead.findUniqueOrThrow({ where: { id: outcome.resultId } });
  }
  const startsAt = new Date(data.startsAt!);
  const outcome = await runOnce(ctx.actionKey("viewing"), ctx.contact.id, "viewing", (bind) => createViewingRequest(data.listingId, lead!.userId ?? undefined, {
    leadId: lead!.id,
    preferredTimes: [{ startsAt, endsAt: new Date(startsAt.getTime() + 60 * 60_000), timezone: "Africa/Accra" }],
    requesterNote: "Requested via NesAfric WhatsApp.",
  }, { inTransaction: bind((tx) => recordEventInTx(tx, "viewing_requested", ctx.contact.id, { listingId: data.listingId })) }));
  ctx.say(`📅 Viewing *requested* for *${data.title}* on ${dateTimeText(startsAt)}.\nReference: ${referenceFor("VW", outcome.resultId)}\n\nThis is not confirmed yet — the agent will confirm or suggest another time, and I'll let you know here.`);
  ctx.ask("Anything else?", [{ id: "pi:back", title: "Back to results" }, { id: "menu", title: "Main menu" }]);
  ctx.step("after");
}

/** Returns to the search this inquiry came from (same criteria and page), or starts a new one. */
function backToResults(ctx: Ctx) {
  const search = ctx.state.data.search as Record<string, unknown> | undefined;
  if (search) {
    ctx.state.data = search;
    ctx.handoff = { workflow: "property_search", seed: { preset: "resume-results" } };
    return;
  }
  ctx.handoff = { workflow: "property_search", seed: {} };
}

async function beginMode(ctx: Ctx, mode: Mode) {
  const data = ctx.data<Data>();
  data.mode = mode;
  if (mode === "inquiry") {
    ctx.step("question");
    ctx.prompt(`What would you like to know about *${data.title}*? (e.g. "Is parking available?" or "Can I pay monthly?")`);
    return;
  }
  ctx.step("time");
  ctx.prompt("When would you like to view it? Reply with a day and time, e.g. *Saturday 10am* or *25/10 3pm*.");
}

export const propertyInquiry: Workflow = {
  key: "property_inquiry",

  async start(ctx: Ctx, seed: StartSeed) {
    const [mode, listingId] = (seed.preset ?? "").split(":") as [Mode, string];
    // Keep the search so "Back to results" works.
    const search = ctx.state.workflow === "property_search" ? { ...ctx.state.data } : (ctx.state.data.search as Record<string, unknown> | undefined);
    const listing = listingId ? await loadListing(listingId) : null;
    if (!listing) {
      ctx.say("Sorry — that property is no longer available on NesAfric.");
      ctx.finish();
      return;
    }
    ctx.go("property_inquiry", "question", { listingId: listing.id, title: listing.title, mode, ...(search ? { search } : {}) });
    if (listing.bookable || isBookableCategory(listing.category)) {
      ctx.say(`*${listing.title}* is a ${categoryLabel(listing.category).toLowerCase()} booked by the night. You can check dates and request a booking here:\n${propertyUrl(listing.id)}`);
      ctx.ask("Anything else?", [{ id: "pi:back", title: "Back to results" }, { id: "menu", title: "Main menu" }]);
      ctx.step("after");
      return;
    }
    if (!listing.contact.enquiryEnabled) {
      ctx.say(`The agent for *${listing.title}* isn't taking inquiries through NesAfric right now. You can still view it here: ${propertyUrl(listing.id)}`);
      ctx.finish();
      return;
    }
    if (mode === "inquiry") ctx.say(listingCard(listing, null, ctx.now));
    await beginMode(ctx, mode === "viewing" ? "viewing" : "inquiry");
  },

  async handle(ctx: Ctx) {
    const data = ctx.data<Data>();
    const choice = ctx.choice;
    if (choice === "pi:back") return backToResults(ctx);
    if (choice?.startsWith("pi:viewing:")) return beginMode(ctx, "viewing");
    if (choice === "pi:send") return data.name ? submitInquiry(ctx) : askName(ctx);

    switch (ctx.state.step) {
      case "question": {
        if (!ctx.text) return propertyInquiry.reprompt(ctx);
        data.question = ctx.text.slice(0, 2000);
        const listing = await loadListing(data.listingId);
        if (!listing) {
          ctx.say("Sorry — that property is no longer available on NesAfric.");
          return ctx.finish();
        }
        const answer = answerFromListing(ctx.text, listing, ctx.now);
        ctx.step("send");
        ctx.ask(`${answer ? `From the listing:\n${answer}\n\n` : "I don't have that detail in the listing. "}Shall I send your question to the agent?`, [
          { id: "pi:send", title: "Send to agent" },
          { id: `pi:viewing:${data.listingId}`, title: "Request a viewing" },
          { id: "pi:back", title: "Back to results" },
        ]);
        return;
      }
      case "send": {
        const yes = parseYesNo(ctx.text);
        if (yes === true) return data.name ? submitInquiry(ctx) : askName(ctx);
        if (yes === false) return backToResults(ctx);
        return propertyInquiry.reprompt(ctx);
      }
      case "name": {
        const name = choice === "pi:name:profile" ? ctx.contact.profileName?.trim() : ctx.text;
        if (!name || name.length < 2 || name.length > 160) return propertyInquiry.reprompt(ctx);
        data.name = name;
        return data.mode === "viewing" && data.startsAt ? submitViewing(ctx) : submitInquiry(ctx);
      }
      case "time": {
        const startsAt = parseDateTime(ctx.text, ctx.now);
        if (!startsAt) {
          ctx.prompt("Sorry, I need both a day and a time — e.g. *tomorrow 2pm* or *Saturday 10:30am*.");
          return;
        }
        if (startsAt.getTime() < ctx.now.getTime() + 60 * 60_000) {
          ctx.prompt("That time has passed or is too soon. Please choose a time at least an hour from now.");
          return;
        }
        if (startsAt.getTime() > ctx.now.getTime() + 180 * 86_400_000) {
          ctx.prompt("Please choose a time within the next six months.");
          return;
        }
        data.startsAt = startsAt.toISOString();
        ctx.step("confirmTime");
        ctx.ask(`Request a viewing on *${dateTimeText(startsAt)}*?`, [
          { id: "pi:time:yes", title: "Yes, request it" },
          { id: "pi:time:change", title: "Change time" },
        ]);
        return;
      }
      case "confirmTime": {
        if (choice === "pi:time:change" || parseYesNo(ctx.text) === false) return beginMode(ctx, "viewing");
        if (choice !== "pi:time:yes" && parseYesNo(ctx.text) !== true) return propertyInquiry.reprompt(ctx);
        return data.name ? submitViewing(ctx) : askName(ctx);
      }
      case "after":
        if (detectCommand(ctx.text) === "more") return backToResults(ctx);
        return propertyInquiry.reprompt(ctx);
      default:
        return propertyInquiry.reprompt(ctx);
    }
  },

  async reprompt(ctx: Ctx) {
    const data = ctx.data<Data>();
    switch (ctx.state.step) {
      case "question":
        return beginMode(ctx, "inquiry");
      case "time":
        return beginMode(ctx, "viewing");
      case "name":
        return askName(ctx);
      case "send":
        ctx.ask("Shall I send your question to the agent?", [{ id: "pi:send", title: "Send to agent" }, { id: "pi:back", title: "Back to results" }]);
        return;
      case "confirmTime":
        ctx.ask(`Request a viewing on *${dateTimeText(new Date(data.startsAt!))}*?`, [{ id: "pi:time:yes", title: "Yes, request it" }, { id: "pi:time:change", title: "Change time" }]);
        return;
      default:
        ctx.ask("What would you like to do?", [{ id: "pi:back", title: "Back to results" }, { id: "menu", title: "Main menu" }]);
    }
  },
};
