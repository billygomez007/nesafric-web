# Mobile: Saved properties

## Behaviour
- **Where saves live:** on the device only (AsyncStorage key `nesafric.saved-listings.v1`, up to 200 listings, newest first). No account is needed; signed-in and guest users behave the same.
- **How to save:** tap the heart on any listing card (Home shelves, Search results, Saved) or in the listing-detail header. There is one shared store, so every heart and the Saved tab always agree.
- **Duplicates:** impossible. Saving is keyed by listing id, and duplicates in storage are dropped on load.
- **Storage failures:** if the device refuses a write, the change is undone and the Saved tab says so. It never shows a save that didn't persist.
- **Snapshots:** each saved listing is stored with a snapshot, so the Saved tab renders offline. Each visible card re-checks its listing through the public API, using the same `["listing", id]` query as the detail screen. When newer data arrives, the card and the stored snapshot update (price, photos, verification).
- **Pull to refresh:** re-checks the visible saved listings. If the device is offline, a notice explains that saved details are being shown.
- **Unavailable listings:** `GET /api/public/listings/:id` returns 404 unless a listing is published, verified and its property is available. Such saved listings appear as **No longer available**, with only the title the user saved (no stale price or photo) and a **Remove from saved** action.
- **Broken photos:** a failed photo on the Saved screen falls back to a "Photo unavailable" block.
- **Empty state:** "Save properties you love", with **Explore properties** opening Search.

## Backend gap
There is no favourites/saved-listings API or model on the server. Consequences:
- Saves don't follow the user to another device or survive reinstalling the app.
- Saves on a shared device are shared by everyone who uses the app on it.
- The platform can't see saves (no analytics, no "listing saved" notifications).

A later server-side feature would need:
- An authenticated `SavedListing` (userId, listingId, unique pair) with list, add and remove endpoints.
- A one-time merge of the device list into the account on sign-in.
- The same 404/unavailable semantics as the public detail route.

Until then, the app states plainly that saves are kept on this device.
