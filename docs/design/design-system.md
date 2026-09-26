# NesAfric design system

> A surveyor's precision, a brochure's warmth, a ledger's honesty.

Source of truth: `src/app/globals.css` (tokens), `src/components/ui/*` (primitives).
This replaces the image in `design/reference/` wherever the two disagree — in particular metric
tiles, fixed charts, glowing maps, icon grids and glass cards are not part of the system.

## Typography

| Role | Face | Where |
|---|---|---|
| Display | Montserrat (variable, self-hosted) | `h1`, `h2`, `.font-display`, navigation, marketing display |
| Text | Inter (variable, self-hosted) | body, forms, tables, dense operational data |

- Both fonts ship every weight (`font-synthesis: none` prevents faked bold).
- Money and counts use tabular figures (`tabular-nums`, or automatically inside `table`).
- Marketing h1 ≈ 40–68px (`clamp`), section h2 30–40px, letter-spacing no tighter than −0.03em.
- Eyebrows: at most one small label per page; prefer a short sentence-case line over an
  uppercase tracked label.

## Colour

- Forest (`forest-deep`, `forest`), emerald and teal are the identity. Teal is for interaction
  accents, not large fills behind white text.
- **Gold means money or verification.** Gold *text* on light surfaces uses `gold-ink`
  (5.34:1); `gold`/`gold-soft` are for fills, rules and text on forest.
- Neutrals: `ink`, `muted`, `hairline`. Legacy `slate-*` utilities are re-tinted to warm neutrals
  with equal or better contrast; use `slate-500`+ for text on light surfaces.
- Semantic: `success`, `warning`/`warning-ink`/`warning-tint`, `danger`/`danger-ink`/`danger-tint`.

## Geometry, borders and elevation

| Token | Value | Use |
|---|---|---|
| `--radius-media` | 4px | photographs |
| `--radius-control` | 6px | buttons, inputs (`rounded-lg`) |
| `--radius-panel` | 8px | content panels (`rounded-xl`, `rounded-2xl`) |
| `rounded-3xl` | 10px | rare large containers |

Pills (`rounded-full`) only for status dots, filter chips and avatars. Content panels sit on
1px `hairline` borders; `shadow-sm` is an almost-invisible edge and `shadow-card` is nothing.
Shadows (`shadow-float`, `shadow-popover`, `shadow-md+`) are for menus, sheets, popovers, dialogs.

## Buttons (`buttonClass(variant, size)`)

| Variant | Use |
|---|---|
| `primary` | forest on light surfaces |
| `primaryOnDark` | gold on forest |
| `secondary` / `secondaryOnDark` | hairline outline |
| `tertiary` | text link |
| `danger` | destructive confirmation |

`md` is 44px high (touch), `sm` 36px for dense toolbars. Disabled buttons use an explicit muted
fill and text, never opacity alone.

## States (`src/components/ui/states.tsx`)

`Skeleton`, `LoadingState` (announces a label), `EmptyState` (title, one line of why, the next
action), `ErrorState` (plain title, message, optional retry), `SuccessNotice`. App-wide
`src/app/error.tsx` and `src/app/not-found.tsx` follow the same pattern.

## Signatures

- **Address-first identity** — `Unit B4 · Ridge House`, then area.
- **Brochure spec strip** — `4 bed · 4 bath · 320 m²` on a hairline.
- **Ledger rows** — label left, value right, hairline between, tabular money.
- **Lifecycle rail** — Vacant → Listed → Viewing → Let → Rent → Maintenance → Renewal.
- **Numbered editorial rows** — `01` in `gold-ink`, title, one sentence.
- **Coded product fragments** (`src/components/marketing/product-fragments.tsx`) instead of
  screenshots or renders; always labelled "Illustrative example".

## Workspaces — one system, different hierarchy

| Workspace | Primary object | Home answers |
|---|---|---|
| PropertyOS | unit | Who owes rent, what's broken, which leases end |
| Professional | listing and lead | Which enquiries need a reply, today's viewings |
| Service provider | job | Today's jobs, where, and what's needed to get paid |
| Platform admin | queue | What needs a human (verification, escalations, failed payments) |

Admin is the calmest and least branded; marketing is the most editorial.

### Service provider workspace (design only — not built)

Phase 1 does not add routes, APIs or data for this workspace. Today the workspace switcher only
knows `propertyos` and `marketplace`, and providers have onboarding
(`service-provider-onboarding-form.tsx`), a public profile (`/marketplace/[providerId]`) and
marketplace settings, but no workspace of their own.

Intended experience, mobile-first:

- **Navigation:** Today · Jobs · Schedule · Earnings · More (bottom tabs on mobile).
- **Today:** job rows — address-first, time window, access notes, call-the-manager action.
- **Job detail:** request details and photos → quote → approval → before/after photos → sign-off.
- **Earnings:** a ledger of completed jobs, amounts owed and paid.
- **Profile:** completeness checklist (trades, service areas, verification documents).

Components it reuses: ledger rows, address-first record header, `EmptyState`, lifecycle rail
(Reported → Approved → Assigned → Done → Paid), buttons, states.

Backend capability that would be needed (to be confirmed against the existing maintenance,
work-order, provider-assignment and provider-quotation APIs before any build): a provider-scoped
job list, job status transitions available to the provider, evidence upload for provider users,
and provider-facing payment history.
