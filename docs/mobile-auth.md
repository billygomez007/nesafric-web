# Mobile sign-in (optional account access)

The NesAfric app is marketplace-first: it opens straight into public listings and never requires an
account to browse, save properties on the device, or contact a lister. Signing in is optional and
reuses the web platform's existing identity, sessions and permissions — there is one NesAfric
account per person, never a separate "landlord" or "agent" account.

## How it works

| Step | What happens | Code |
| --- | --- | --- |
| Sign in | `POST /api/auth/mobile/session` with `{ email, password }`. Same checks as the web login: per-email lockout (8 failures / 15 min → `429 LOGIN_RATE_LIMITED`), argon2 password verification, identical `401 INVALID_CREDENTIALS` for a wrong password or unknown email. | `src/app/api/auth/mobile/session/route.ts` |
| Token | An ordinary `Session` row: 32 random bytes, stored **only as a SHA-256 hash**, 14-day expiry. The raw token appears once, in that response body (`Cache-Control: no-store`); no cookie is set and nothing token-related is logged. | `createSessionRecord` in `src/platform/auth/session.ts` |
| Authenticated calls | `Authorization: Bearer <token>`. `getOptionalUser` / `requireUser` read the web cookie first and otherwise a well-formed bearer token (base64url, 16–256 chars; the scheme name is case-insensitive). Every API that uses them works for the app, with the same membership and permission checks. | `parseBearerToken`, `readSessionToken` |
| Workspaces | `GET /api/workspaces` returns only organisations and professional profiles the user is an active member of. The app sends `x-organisation-id` only for an organisation from that list; the server re-checks membership and permissions on every call (`/api/dashboard` needs `property.read`). | `src/app/api/workspaces`, `src/app/api/dashboard` |
| Sign out | Local first, then server (details below). `POST /api/auth/logout` (the web route) deletes that session row and returns `204`. | `mobile/src/auth/session.tsx`, `destroySession` |
| Revocation | On the server the token stops working when it expires, when a sign-out request **reaches** the server, or when the password is changed (which deletes all the user's sessions). Other devices stay signed in after one device signs out. | |

Web cookie sign-in is unchanged; if a request carries both a cookie and a bearer token, the cookie
wins. Browsers never add an `Authorization` header by themselves, so accepting bearer tokens adds no
cross-site request forgery exposure.

## Sign-out, exactly

1. **On tap, local access stops at once.** The in-memory token is dropped, account queries are
   cancelled and removed, and the Account tab shows the signed-out screen. Any new account request
   is refused in the app without touching the network. The app does not wait for the server.
2. **The credential is deleted from secure storage.** A non-secret AsyncStorage flag
   (`nesafric.signed-out.v1` = `"1"`, never the token) is written first; while it is set, the
   stored credential is never restored. If deletion fails, the app overwrites the entry with an
   unusable value and keeps the flag, shows "We couldn't fully remove your sign-in from this
   device's secure storage…", and retries the deletion on the next launch. Only if neither the flag
   nor the overwrite can be written does it warn that the sign-in may come back after a restart,
   with **Try again**.
3. **Server revocation runs in the background** with the token captured at tap time (10 s
   timeout). The notice reads:
   - while waiting: "You're signed out on this device. Ending your session on NesAfric…"
   - `204` (or `401`, meaning the server already rejects it): "…your session on NesAfric has ended."
   - offline / timeout / server error: "…we couldn't reach NesAfric to end the session there. It
     stays valid on our servers until {expiry date}, or until you change your password on
     nesafric.com (which signs out every device)." **Try again** re-sends the logout with the
     token, which is held **in memory only** for this purpose. Dismissing the notice or restarting
     the app forgets it, so after that the session can only be ended by expiry (14 days) or a
     password change.

**Offline sign-out does not revoke the server session.** The device can no longer use it, but
anyone who had copied the token could, until it expires or the password is changed.

Concurrent requests: a request already sent before the tap may still be answered by the server,
but its result is discarded (its query was removed), and a late `401` from it does not show the
"session ended" notice. The revocation call uses its own token, so if the person signs in again
before it finishes, its result can't sign the new session out. On the next launch, a signed-out
device starts signed out.

## What the app stores

| Data | Where | Why |
| --- | --- | --- |
| Session token, its expiry, and `{ id, email, displayName }` | `expo-secure-store` (iOS Keychain / Android Keystore), `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` | Credential. Never in AsyncStorage. The web preview build keeps it in memory only. |
| Signed-out flag `nesafric.signed-out.v1` (`"1"`) | AsyncStorage | Not a secret. Blocks restoring a credential whose deletion failed; cleared once it is gone or on the next successful sign-in. If it can't be read at launch, the app starts signed out. |
| Last opened workspace id (per user) | AsyncStorage | Not a secret; only used if the server's current list still contains it. |
| Saved properties | AsyncStorage (unchanged) | Device-only, kept across sign-in and sign-out. |

On launch the app restores an unexpired stored session unless the signed-out flag is set; an
expired or malformed one is deleted. Any `401` on an authenticated call for the current session
ends it locally with a "you've been signed out" notice, while the marketplace keeps working.

Known limit: on iOS, Keychain items can survive uninstalling the app while AsyncStorage does not. If
a deletion failed and the app is then uninstalled and reinstalled, the flag is gone; the overwrite
in step 2 is what protects that case, so a credential is only restorable if both the deletion and
the overwrite failed.

## Registration

The app does not add a registration endpoint. "Create an account" opens the existing web
registration page, so the same rules apply (valid email, 12+ character password, unique email). A
new account has no organisation, role or permission; workspaces appear only once the person creates
or is invited to one on the website. There is no role picker in the app.

## Not in this phase

Password reset (no backend flow exists yet), Google sign-in in the app, service-provider
workspaces (not returned by `/api/workspaces` today), management screens beyond the read-only
workspace overview, and push notifications. None of these appear in the app's navigation.

## Configuration

No migration and no new environment variables. The app needs `EXPO_PUBLIC_API_URL` pointing at a
backend it may sign in to — use a local or genuinely isolated test backend for development, never a
Preview deployment that shares production data.
