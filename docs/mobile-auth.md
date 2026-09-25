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
| Sign out | `POST /api/auth/logout` (the web route) deletes that session row. The app clears its local copy even if the server can't be reached. | `destroySession` |
| Revocation | The token stops working when it expires, when that device signs out, or when the password is changed (which deletes all the user's sessions). Other devices stay signed in after one device signs out. | |

Web cookie sign-in is unchanged; if a request carries both a cookie and a bearer token, the cookie
wins. Browsers never add an `Authorization` header by themselves, so accepting bearer tokens adds no
cross-site request forgery exposure.

## What the app stores

| Data | Where | Why |
| --- | --- | --- |
| Session token, its expiry, and `{ id, email, displayName }` | `expo-secure-store` (iOS Keychain / Android Keystore), `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` | Credential. Never in AsyncStorage. The web preview build keeps it in memory only. |
| Last opened workspace id (per user) | AsyncStorage | Not a secret; only used if the server's current list still contains it. |
| Saved properties | AsyncStorage (unchanged) | Device-only, kept across sign-in and sign-out. |

On launch the app restores an unexpired stored session; an expired or malformed one is deleted. Any
`401` on an authenticated call ends the session locally with a "you've been signed out" notice,
while the marketplace keeps working.

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
