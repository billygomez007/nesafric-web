# Mobile workspace inbox (read-only enquiries & viewings)

Inside a property-management workspace **or an agent (marketplace professional) workspace**, a
signed-in member can read the marketplace enquiries and viewing requests it has received. It is **read-only**: no status changes, replies,
assignment or notifications. Those stay on nesafric.com (`/leasing/leads/:id`,
`/leasing/viewings/:id`), linked from each detail screen.

## APIs used

Every call adds `view=inbox` (see *Response shapes*).

**Property-management organisations** (`/workspace/:organisationId/…` in the app):

| Screen | Request | Server checks |
| --- | --- | --- |
| Section access + totals | `GET /api/marketplace-leads?page=1&pageSize=1`, `GET /api/viewing-requests?page=1&pageSize=1` | session; `x-organisation-id`; `listing.lead.read` / `listing.viewing.read` (403 otherwise) |
| Lists | same routes, `page=N&pageSize=20`, newest first | same; rows filtered by organisation |
| Details | `GET /api/marketplace-leads/:id`, `GET /api/viewing-requests/:id` | same; another organisation's id is `404` |

**Agent workspaces** (`/agent/:professionalId/…` in the app) use the routes the website's agent
CRM already uses. No `x-organisation-id` is sent:

| Screen | Request | Server checks |
| --- | --- | --- |
| Section access + totals, lists | `GET /api/marketplace-professionals/:id/leads`, `…/:id/viewings` | session; **active** membership (any role) of a non-archived professional (403 / 404 otherwise) |
| Details | `GET /api/marketplace-professionals/:id/leads/:leadId`, `…/:id/viewings/:viewingRequestId` (new, read-only) | same; an enquiry or viewing on another professional's listing is `404` |

Rows are scoped by the **listing's professional** (`listing.marketplaceProfessionalId`), never by
an organisation the client names. That includes listings an agency markets for a landlord, whose
enquiries belong to the landlord's organisation. The landlord's team sees those through the
organisation routes, and the agency's team through the professional routes.

The app sends an organisation or professional id only if it is in the server's own
`/api/workspaces` list, and only with the bearer session (`docs/mobile-auth.md`).

## Who can see an agent workspace's enquiries

- Every member whose membership is `ACTIVE`, in any role (AGENT, ADMIN, OWNER), sees all
  enquiries and viewings on the professional's listings, assigned to them or not. This is the same
  rule the website's agent CRM already applies.
- `INVITED`, `SUSPENDED` and `REMOVED` members, members of other professionals, the landlord and
  anyone else get `403`. Creating a profile grants nothing without an active membership.
- An **archived** professional's inbox returns `404`, and it no longer appears in
  `/api/workspaces`.
- A **suspended** professional (profile status `SUSPENDED`) keeps read access, as on the website.
  The app shows a notice on its workspace screen.
- The app never uses an agency's backing organisation. It is not returned by `/api/workspaces`.
  Sending it as `x-organisation-id` on the organisation routes only works for members of that same
  professional, and then only returns that organisation's own rows.

## Response shapes (server-enforced)

All lead and viewing routes now return explicit shapes (`src/modules/listings/lead-responses.ts`),
never raw database rows:

- **Never returned by any view:**
  - the duplicate-submission hashes (`idempotencyKeyHash`, `idempotencyFingerprint`);
  - owning organisation and user ids;
  - the enquirer's account record;
  - actor ids and activity metadata;
  - application tenant/lease/applicant ids;
  - team members' email addresses.
- **`full` (default, the website):** adds the staff-only `privateNotes`, `assigneeMemberId`,
  activity entries and status-change notes. These are the fields the leasing CRM and agent CRM
  edit and show.
- **`view=inbox` (the app):** no private notes, no activities, no status-change notes. List rows
  are only `id, name, status, createdAt, lastActivityAt, listing`, so the app never receives
  contact details for a whole page of enquiries.
- **List queries** fetch only what their shape needs; they no longer load history, activities or
  full related records.
- **PATCH and assign responses** use the `full` shape too. The website only reads their error
  messages.

## Permissions

No API tells the app which permissions a member has, so the app asks the server directly: the
one-row requests above. `200` shows the section with the server's `pagination.total`; `403` hides it.
If both are refused, the "Enquiries & viewings" entry is not shown at all, and opening the inbox URL
directly shows "Your role here doesn't include enquiries or viewings". There is no client-side role
logic; every list and detail call is re-checked by the server. The entry is independent of the
property dashboard, so a member with lead access but no `property.read` still sees it. In the
seeded roles, `property_manager` and `viewer` can read both; owners can read everything.

## Screens and states

- **Workspace overview:** "Enquiries & viewings" card with one row per allowed section ("2
  enquiries", "1 viewing request"); loading, offline/error + Try again.
- **Inbox:** Enquiries | Viewings tabs (only allowed ones). Rows: name, listing, status, received
  date (viewings: confirmed time, else first preferred window in its time zone). Pull to refresh,
  "Showing X of Y", infinite scroll plus a **Load more** button, "Couldn't load more · Try again",
  "That's everything", empty and offline states. Network failures are retried twice automatically
  before an error is shown.
- **Enquiry detail:** status, name, listing, received, contact, message, source, assignee, last
  activity, applications, related viewings (tappable only if viewings are allowed), status history.
- **Viewing detail:** status, name, listing, confirmed time / preferred windows with time zone,
  contact, requester note, outcome, assignee, link to the enquiry (only if enquiries are allowed),
  status history.
- Details open instantly from the row already in the list, then refresh from the detail endpoint;
  a `403`/`404` from the server always replaces that placeholder.

## Contact actions

**Call** and **Email** appear only for a usable value (`mobile/src/workspace/contact.ts`): a phone
number of 9–15 digits (spaces, dashes, brackets and a leading `+` allowed) and an email of normal
shape. The public form accepts any 5–50 character phone string, so values like "call me" exist;
those show no Call button. The app opens the phone or mail app directly, like its existing support
links (iOS asks before placing a call; Android opens the dialer without dialling); a failure to
open shows an inline message.

## Privacy

- Enquiry data lives only in React Query memory, keyed
  `["account", userId, "inbox", organisationId, …]`. React Query is not persisted; nothing is
  written to AsyncStorage or secure storage, and nothing is logged.
- **Sign-out / session expiry:** removed with all account data (`mobile/src/auth/session.tsx`).
- **Workspace change:** opening a workspace screen removes every other workspace's inbox data
  (`clearOtherWorkspaces`). Queries are also garbage-collected 5 minutes after their screens close.
- Private notes, activity metadata and the submission hashes are not sent to the app at all (see
  *Response shapes*).

## Known gaps

1. No endpoint lists a member's permissions per organisation (the one-row probe stands in).
2. No status filter in the app yet (the API supports one `status` at a time).
3. Agent roles don't narrow visibility: an AGENT sees every enquiry of the agency, not only those
   assigned to them. That matches the website today; restricting it is a product decision.
4. A suspended professional's members can still read its inbox (website behaviour, unchanged).
