# Saved listings API

Server-side saved properties ("favourites") for signed-in users. The same routes serve the web session cookie today; the mobile bearer session (PR #9) uses the same `requireUser`, so mobile works without changes once that lands.

## Endpoints
All endpoints require a signed-in user (401 `UNAUTHENTICATED` otherwise), answer `Cache-Control: no-store`, and use the standard error envelope `{ error: { code, message, details?, issues? } }`.

| Method & path | Result |
|---|---|
| `GET /api/account/saved-listings?page=1&pageSize=20` | `{ items: [{ listingId, savedAt, available, listing }], pagination: { page, pageSize, total, totalPages } }`, newest first. `pageSize` ≤ 50. |
| `GET /api/account/saved-listings/ids` | `{ listingIds: [...] }`, newest first. Lets clients show heart states without loading listings. |
| `PUT /api/account/saved-listings/:listingId` | Saves. **201** `{ listingId, savedAt, created: true }` when new; **200** with `created: false` when already saved. |
| `DELETE /api/account/saved-listings/:listingId` | **204**, idempotent. Only ever removes the caller's own save. |
| `POST /api/account/saved-listings/import` | Body `{ listingIds: uuid[] }` (≤ 200, newest first). Adds the eligible ids not yet saved, keeping the device order. Returns `{ imported, skipped, total }`. Safe to repeat. |

## Rules
- **Eligibility:** only listings the public marketplace shows can be saved. That is PUBLISHED, VERIFIED, and the underlying property, unit or asset still available: the same rules as `GET /api/public/listings/:id`, via `getPublicListingsByIds`. Anything else answers **404 `NOT_FOUND`**, like the public route, so hidden listings can't be probed.
- **Leaving the marketplace:** a saved listing that is later paused, let, withdrawn or unverified stays saved. It is listed with `available: false` and `listing: null`, and none of its data is returned. The user can remove it.
- **Duplicates:** impossible. There is a unique `(userId, listingId)`; concurrent saves converge on one row.
- **Limit:** 500 saves per user. Beyond that, a save answers **422 `SAVED_LISTINGS_LIMIT`** with `details.limit`, and imports stop at the limit.
- **Validation:** ids must be UUIDs; unknown query or body keys are rejected (**400 `VALIDATION_ERROR`** with `issues`). A malformed JSON body answers **400 `INVALID_JSON`**.
- **Isolation:** every query is scoped to the signed-in user.
- **Data:** table `SavedListing` (migration `20260926090000_saved_listings`, additive). Rows are deleted with their user or listing.

## Mobile integration (later, in the mobile stack)
The app currently keeps saves on the device (`nesafric.saved-listings.v1`). Once mobile bearer sessions are merged:
1. On sign-in, `POST …/import` with the device ids (newest first), then read `GET …/ids`.
2. When signed in, save and unsave through `PUT` and `DELETE`, keeping the device list as an offline cache. Signed-out users keep device-only saves.
3. Render `available: false` items as "No longer available", as the app already does for 404s.
