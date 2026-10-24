# WhatsApp shopping assistant: audit (2026-10-24)

The shopping assistant is the customer side of the official NesAfric WhatsApp number: finding a property or a service provider, asking about a listing and requesting a viewing. Code: `src/modules/whatsapp-assistant/engine.ts` (conversation), `interpret.ts` (reading a request), `tools.ts` (marketplace search and submissions), `viewing-time.ts` (viewing dates). Deployment, number assignment and the go-live checklist are in `docs/whatsapp-operations.md`.

## Where it stands

| Area | State |
|---|---|
| Property search (rent or buy, area, type, bedrooms, budget, frequency) | Done. Asks for whatever is missing; 3 results per page with `more`. |
| Service-provider search (trade and area, verified providers only) | Done. Contact and quotes continue on the provider's profile page. |
| Listing details, inquiry, viewing request | Done. Nothing is written until the shopper replies `confirm`; submissions reuse the listing domain's idempotency keys. |
| Request status (`status`) | Done. Only the request saved in this conversation, matched to the sender's phone. |
| Reading free text | Done. Deterministic rules always; an AI provider (`AI_PROVIDER`) can fill search fields only, with a 10 s timeout and the rules as fallback. It never chooses records, identities or permissions. |
| Menu, `resume`, `cancel`, `support` hand-off | Done. |
| Number assignment, quarantine, provenance, rate limit (20 per minute per conversation) | Done (see the runbook). |
| Real Meta delivery end to end | **Not verified.** Every test uses a recording adapter. |

## Fixed in this change

- **Viewing times.** Shoppers had to type `2026-12-20T14:00:00+00:00`. The assistant now reads `tomorrow 2pm`, `saturday 10:30am`, `20/12 14:00`, `20th December 3pm`, `Dec 20 at 3:30pm` and ISO dates, as Ghana time (GMT). Anything vague (`tomorrow evening`, `next week`), past, impossible (`31/02`) or more than a year ahead is refused and asked again. The review and status replies show `Sun 20 Dec 2026, 2:00 pm GMT` instead of an ISO timestamp.
- **Picking a result.** After results, a bare `2` opened provider search and paused the property search. It now opens property 2's details. In provider results it points to that provider's profile link.
- **Budgets.** `4000 cedis`, `₵3000`, `max ghs 4,500`, `for 3000 a month`, `2 million cedis`, `per annum` and `2br` were missed or misread. `around 4000` was taken as an area, and `in kasoa 2 million cedis` made the area `kasoa 2 million cedis`. Room counts (`for 2 bedrooms`) are never read as prices.
- **Tests.** The conversation engine and the rules interpreter had no unit tests. `tests/whatsapp-shopping-assistant.unit.test.ts` covers the full find → details → view → confirm path, missing-field prompts, rental frequency, paging, out-of-range picks, provider results, budget and area parsing, and viewing-time parsing.

## What is left

Product gaps, in suggested order:

1. **Go-live checklist (runbook section 6).** Needs Meta credentials, approved templates and real phones; it cannot be done from code. Add these shopping checks: `hi` → `1` → `rent` → an area → results; `2` opens details; `view 1`, a name, `tomorrow 2pm`, `confirm` → the lead and viewing appear in the listing team's inbox; `status` shows it.
2. **Bookable short stays.** Listings with instant booking only get a link (`enquiryEnabled && !bookable`). Booking in chat needs payment in WhatsApp (mobile money), which is a separate project.
3. **Provider quotes in chat.** Provider results link to the profile. A `quote 1` flow would need the provider-quotation domain to accept anonymous WhatsApp leads.
4. **Location pins and photos from shoppers.** Rejected with an explanation. A shared location could become the search area.
5. **Clearing a filter.** Filters only narrow or change (`under 5000`, `in tema`); there is no `any budget`. `cancel` starts again.
6. **Exact bedroom counts.** `3 bedroom` searches exactly 3; `3+` is not understood.
7. **Notifying the shopper.** A viewing the agent confirms is visible through `status` but is not pushed to the shopper on WhatsApp. That needs a template message, because the 24-hour window will usually have closed.
