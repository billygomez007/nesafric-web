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
The app keeps saves on the device today (`nesafric.saved-listings.v1`). Once mobile bearer sessions (PR #9) are merged:

- **Signed out:** unchanged. Saves stay on the device only.
- **On sign-in (once per sign-in):**
  1. `POST …/import` with the device ids, newest first.
  2. `GET …/ids` and replace the local heart state with the server list; the server is authoritative. Duplicates can't occur, because import skips ids that are already saved.
  3. Refresh listing data from `GET …` or the public detail route.
- **Signed in:**
  - Tapping the heart updates the UI at once, then calls `PUT` or `DELETE`. On failure the change is undone and the user is told.
  - `PUT`, and `DELETE` of something already removed, are idempotent, so retries after a timeout are safe.
  - A 404 on `PUT` means the listing left the marketplace. A 422 `SAVED_LISTINGS_LIMIT` means the account is full.
  - The device keeps a cached copy for offline display.
- **On sign-out:** remove the account's saved list from the device. The saves stay on the server and come back at the next sign-in. This avoids showing one person's saves to the next person using a shared phone. The device then starts an empty signed-out list.

No API change is needed for this flow.

## Release runbook (for approval; nothing here has been run against production)
**Migration:** `20260926090000_saved_listings`.
- It is additive: `CREATE TABLE "SavedListing"`, 3 indexes and 2 foreign keys.
- No existing table is altered and no existing data is rewritten.

**Lock and duration:**
- The table and indexes are created empty, which is instant.
- Adding each foreign key briefly takes a SHARE ROW EXCLUSIVE lock on `User` and `Listing`, blocking writes to those tables but not reads. Validation is instant because the new table is empty.
- Expect well under a second in total.

**Order: migration first.**
- The current production code never touches the new table, so migrating first is invisible to users.
- If the new code went live before the migration, only the new saved-listings routes would fail (500); nothing else uses the table.

1. **Pre-release checks:**
   - `main` is healthy (`/api/health` HEALTHY).
   - Note the current production deployment ID for rollback.
   - Confirm a recent database backup or point-in-time recovery window exists.
   - Confirm `npx prisma migrate status` against production shows only `20260926090000_saved_listings` pending.
2. **Merge** `mobile/cloud-foundation-hardening` into `main` with a normal merge commit.
3. **Migrate** production from a clean checkout of that `main` commit:
   `DATABASE_URL=<production URL> npx prisma migrate deploy`
   It should report exactly one applied migration.
4. **Deploy:** Vercel's Git integration deploys `main`. Wait for READY on the new commit.
5. **Health:** `/api/health` HEALTHY with the database UP; the homepage and marketplace pages return 200.
6. **Anonymous checks:** all five saved-listings routes answer 401.
7. **Signed-in check:** with a test account, not a customer account:
   - `PUT` a public listing → 201;
   - again → 200;
   - `GET …/ids` contains it;
   - `DELETE` → 204.

**Rollback:**
- **Code:** promote the previous production deployment (Vercel Instant Rollback). The new table stays and is simply unused. No data is lost, and re-releasing later needs no migration.
- **Do not drop the table** as part of a rollback. It is harmless while unused, and dropping it would delete users' saves.
- **Only if the table must be removed entirely:**
  1. Remove the migration row: `DELETE FROM "_prisma_migrations" WHERE migration_name = '20260926090000_saved_listings'`.
  2. Then `DROP TABLE "SavedListing"`.
  - This is a deliberate, separate decision after backing the table up.
- **After a rollback:** `/api/health` HEALTHY, and the pages return 200.
