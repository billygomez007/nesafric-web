# WhatsApp flow audit (2026-10-25)

Every entry point on the official NesAfric number (+233 50 282 0002), what it does today, where it
ends, and what is missing. Source of truth: `src/modules/whatsapp-assistant/` on `main` at `fde26d7`,
the production database and the Meta account (read-only checks). Status key: **Works** (ends in a
stored record and a confirmation), **Partial** (works but sends the customer to the website for a
step WhatsApp could do, or misses a promised step), **Missing**.

## Entry points

| Entry point | Steps today | Final destination | Status | Gap |
|---|---|---|---|---|
| Welcome (`hi`, `menu`, unknown text) | Greeting, list of 10 options | Menu | Works | — |
| 1 Find a Property → rent / buy / land / commercial | Rent or buy, area, then free-text filters (type, bedrooms, budget, frequency) | `searchPublicListings` (PUBLISHED + VERIFIED only), 3 text results per page with a website link each | **Partial** | Results are text and links, no cover photo, no action buttons. Filters are free text only, no step-by-step type, bedroom or budget choice. Country is assumed (GH). |
| Result `details N` | Title, description, link | Text | Partial | No price, bedrooms, amenities or photo in the details; no buttons. |
| Result `inquire N` | Name, question, review, confirm | `MarketplaceLead` (source WHATSAPP), reference, `status` | Works | The agent is told by email/in-app only, not on WhatsApp. No natural-language questions answered from listing data. |
| Result `view N` / Book a viewing | Name, time (Ghana time), review, confirm | `ViewingRequest` REQUESTED with a preferred one-hour slot, reference, `status` | **Partial** | No agent response on WhatsApp (accept, propose, decline); no counter-proposal loop; the customer hears of confirmation only through `status`. No reminders. |
| Bookable short stays / hotels | Link only | Website | Partial | Booking with payment needs mobile money; out of scope (external dependency). |
| 2 Manage My Properties (`account`) | Linked-account summary | Properties, tenancies, jobs counts | Works (read) | Property management actions are the maintenance, rules and network commands below. |
| `link` / `unlink` | SMS or email OTP | `ChannelIdentity` link | Works | Creating a new account still needs the website (`/register`). |
| 3 List a Property | Linked account, profile, type, details, location, price, amenities, up to 10 photos, authority reference, review, confirm | DRAFT listing → `PENDING_REVIEW`, reference, decision notice | Works | Hotels and short stays are website-only (nightly pricing). Agencies must be verified before confirming. |
| 4 Register as an Agent | Linked account, details, Ghana Card front and back photos (PRIVATE), review | `MarketplaceProfessional` (INDIVIDUAL_AGENT) pending review | Works | — |
| `register agency` | Company details, logo, business certificate (PRIVATE) | `MarketplaceProfessional` (company type) pending review | Works | — |
| 5 Register Services | Linked account, business details, categories, logo | `ServiceProvider` application pending review | Works | — |
| `list my services` | Categories, price model, up to 10 portfolio images | Provider marketplace profile (`listed` only when approved) | Partial | With no categories yet, it sends the provider to the website. |
| 6 Landlord / Property Manager (`register`) | Account (OTP), organisation, properties, units, tenants, rent terms, tenant invitations | Organisation, properties, units, tenants, DRAFT leases, U17 invitations | Works | Lease execution and ownership proof upload are on the website. |
| 7 Find Property Services | Service, area | Verified providers, 3 per page, profile links | Partial | Contacting or booking a provider continues on the profile page. |
| 8 My Applications | — | Status of registrations and listings | Works | — |
| 9 Help & Support | — | Conversation handed to the staff support queue (`HUMAN_REQUIRED`) | Works | No response-time promise; staff answer from the inbox. |
| More options → find an agent | Area | Verified agents and agencies, profile links | Works | — |
| Tenant repair report | Linked tenant: description, photos | `MaintenanceRequest` with reference, routing to providers | Works | — |
| Provider job commands (`accept`, `quote`, `done`, …) | Per command | Work order updates | Works | — |
| Landlord quote decisions, rules, network | Confirmed commands | Approvals, routing rules, provider network | Works | — |
| `status` | — | Latest inquiry or viewing in this conversation | Works | — |
| STOP / START | — | Opt-out recorded | Works | — |
| Media sent outside a flow | — | Explanation | Works | — |

## Notifications and templates

- Meta account: **66 templates, 64 approved** (all named `nesafric_*`), including
  `nesafric_viewing_requested`, `_confirmed`, `_rescheduled`, `_cancelled`, `_reminder`,
  `nesafric_inquiry_received`, `nesafric_inquiry_agent_alert`, and the listing review set.
- Code registry: 30 templates named `nes_*`. **None of them exists on Meta**, and none of Meta's
  approved templates is known to the code, so no template message can be sent today (decision
  notices, viewing updates, reminders, invitations).
- `WHATSAPP_TEMPLATE_NOTIFICATION` is not set in production.
- 12 WhatsApp Flows exist on Meta, all **DRAFT**; 8 have a validation error. PR #46 holds the
  definitions and the encrypted endpoint; not merged.

## Viewing workflow today

`ViewingRequest` supports REQUESTED, CONFIRMED, RESCHEDULED, COMPLETED, CANCELLED, NO_SHOW with
history, and `updateViewingRequest` enforces the transitions and permissions. The listing team acts
on the website. Missing on WhatsApp: the agent's accept / propose / decline, the counter-proposal
loop, notifying the customer, reminders 2 h and 1 h before, and the after-viewing check.

## Plan (stages)

1. **Property cards:** each result as an image-header message (cover photo, title, location, type,
   bedrooms and bathrooms, price with its period, short description, verification) with
   View property, Ask a question and Book a viewing buttons, sent in order, then Show more,
   Change filters and New search. Fuller details reply.
2. **Step-by-step search:** rent or buy, type (from the live inventory), bedrooms, area (typed),
   budget (suggested ranges or typed), each skippable.
3. **Viewings:** agent alert on WhatsApp, accept / propose / decline, customer accept / propose /
   cancel until agreed, confirmation on both sides, reminders 2 h and 1 h before (Africa/Accra),
   follow-up after the time, using the approved `nesafric_viewing_*` templates outside the 24-hour
   window.
4. **Remaining partial flows:** questions answered from listing data, provider contact requests,
   service categories on WhatsApp, template registry aligned with Meta's approved names.

## Delivered (branch `feat/whatsapp-end-to-end`)

| Stage | Result |
|---|---|
| 1 Property cards | Each result is a button message with the listing's cover photo as an image header (title, type, location, rooms, price with its period or "sale price", short description, verification) and View property / Ask a question / Book a viewing. Show more / Change filters / New search follow. Replies of several messages are sent by one `conversation-message-sequence` job, in order. |
| 2 Step-by-step search | Rent or buy, then type (only published types, with counts), bedrooms (studio, number, range, 5+), area (typed), budget (ranges or typed). Every step but the area can be skipped. |
| 3 Viewings | `ViewingProposal` (migration `20261026090000_whatsapp_viewing_proposals`). A viewing requested in the chat alerts the listing team (lead assignee, else listing representative, else creator) on their linked WhatsApp: buttons inside the 24-hour window, the approved `nesafric_inquiry_agent_alert` outside it. Accept / propose another time / decline from the team; accept / another time / cancel from the customer; confirmed only when one side accepts the other's open proposal, through the listing domain's transitions. Both sides are told; the template dispatcher skips what the negotiation already said. Reminders 2 h and 1 h before (Africa/Accra), to both sides, once per agreed time, dropped if the time moves or the viewing ends; a check 2 h after asks the customer whether it took place and records the answer on the enquiry (the team still marks it completed). |
| Templates | U01-U06, U10, U23-U26 now use Meta's approved `nesafric_*` names and exact text; U31 (`nesafric_inquiry_agent_alert`) added. Values a template does not use are ignored. |

## Remaining

- **Approved templates not yet usable** until synced: set `WHATSAPP_TEMPLATE_WABA_ID=1104581892174096` on Cloud Run and run `npm run whatsapp:templates -- sync` once (read-only on Meta). Event-driven notices also need `WHATSAPP_UTILITY_EVENTS_SINCE` (an ISO time; earlier events are never sent).
- **No Meta template** fits: agent registration received (U07), verification decisions (U08, U09), listing status changes by outcome (U11), tenant invitations (`nesafric_tenant_invitation` is MARKETING), the after-viewing question (sent only inside the 24-hour window).
- **Partial flows unchanged:** service-provider contact or quotes in the chat; service categories with none set; hotels and short stays (payment); account creation (`/register`); lease execution and ownership proof upload; natural-language questions about a listing (the inquiry goes to the listing team instead).
- **WhatsApp Flows** (PR #46): drafts with validation errors; not part of this branch.
- Three pre-existing test failures on `main` (tenant access-code connection and invitations).
