# Mobile workspace inbox (read-only enquiries & viewings)

Inside a property-management workspace, a signed-in member can read the marketplace enquiries and
viewing requests their organisation has received. It is **read-only**: no status changes, replies,
assignment or notifications. Those stay on nesafric.com (`/leasing/leads/:id`,
`/leasing/viewings/:id`), linked from each detail screen.

## APIs used (unchanged; no backend changes in this phase)

| Screen | Request | Server checks |
| --- | --- | --- |
| Section access + totals | `GET /api/marketplace-leads?page=1&pageSize=1`, `GET /api/viewing-requests?page=1&pageSize=1` | session; `x-organisation-id`; `listing.lead.read` / `listing.viewing.read` (403 otherwise) |
| Lists | same routes, `page=N&pageSize=20`, newest first | same; rows filtered by organisation |
| Details | `GET /api/marketplace-leads/:id`, `GET /api/viewing-requests/:id` | same; another organisation's id is `404` |

The app sends `x-organisation-id` only for an organisation in the server's own `/api/workspaces`
list, and only with the bearer session (`docs/mobile-auth.md`).

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
- Fields the app doesn't show are not typed: `privateNotes`, activity metadata and the submission
  hashes. They are still present in the API response (see gaps).

## Known API gaps (not changed here)

1. No endpoint lists a member's permissions per organisation (the probe above stands in).
2. List items include full history, activities, applications and viewings — heavy on 3G. A
   summary projection (and `pageSize` defaults for mobile) would cut payloads substantially.
3. Responses include `privateNotes`, `idempotencyKeyHash` and `idempotencyFingerprint`. The app
   ignores them; a server-side select list should drop the hashes at least.
4. Marketplace professional (agent) workspaces are not reachable: `/api/workspaces` doesn't expose
   their backing organisation, so this inbox covers property-management organisations only.
5. No status filter in the app yet (the API supports one `status` at a time).
