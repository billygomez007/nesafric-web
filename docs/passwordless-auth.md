# Passwordless sign-in (email / SMS codes)

Web and mobile sign in and sign up with a 6-digit code sent by SMS (Arkesel is the code authority —
see `docs/arkesel-sms-otp.md`) or email (NesAfric-generated, sent through Resend),
or with Google. Nobody is asked for a password. One core service (`src/modules/identity/otp.ts`)
backs thin routes:

| Route | Use |
| --- | --- |
| `POST /api/auth/otp/request` | `{ mode: login\|register\|link, channel: sms\|email, identifier }` → `{ challengeId, destination, expiresAt, resendAfterSeconds }` (same answer whether or not an account exists) |
| `POST /api/auth/otp/verify` | Web: `{ challengeId, channel, identifier, code, displayName? }` → session cookie |
| `POST /api/auth/mobile/otp/verify` | Mobile: same body → `MobileSessionResponse` (bearer `Session`) |
| `POST /api/account/identifiers/verify` | Signed in: add a verified phone/email after a `link` code |

`409 OTP_NO_ACCOUNT` (only after a correct code) means no account uses that address; the same
code, sent again with `displayName`, creates it. Sign-up with an address that already has an
account signs into that account (`existingAccount: true`) instead of creating a duplicate.

## Security

- Email codes: `crypto.randomInt`, 10 min. SMS codes: generated, expired (5 min) and checked by Arkesel.
  Both: single use (atomic conditional update), 5 wrong guesses per code, 10 per destination per hour. A newer code supersedes older ones once the provider accepts it.
- Stored: HMAC-SHA256 (key `OTP_HASH_SECRET`, else `SESSION_SECRET`) of the code and the destination.
  No plaintext code or address in the table, logs, analytics or URLs.
- Sends: 1 per 60 s and 5 per hour per destination, 20 per hour per client IP (trusted IP only),
  `OTP_SMS_GLOBAL_HOURLY_LIMIT` SMS per hour overall (default 1000).
- A provider failure is a `503`; the challenge stays unusable. SMS without Arkesel credentials is refused.

## Identity and linking

`User.email` and `User.passwordHash` are nullable; `User.phoneE164` (E.164, unique) and
`phoneVerifiedAt` are new. The database requires every user to have an email or a phone.

| Situation | Result |
| --- | --- |
| Google user later verifies a phone (link) | Phone added to the same user |
| Phone-only user adds an email (link) | Email added; Google with that email reaches the same user |
| Email-only user adds a phone (link) | Phone added to the same user |
| Phone/email already belongs to another account | `409 IDENTIFIER_IN_USE`; nothing changes. Accounts are never merged implicitly |
| Existing password account signs in with an email code | Same user; password hash untouched |

Legacy password routes (`/api/auth/login`, `/api/auth/register`, `/api/auth/mobile/session`,
`/api/account/password`) remain for existing clients with their rate limiting. Accounts without a
password get `INVALID_CREDENTIALS` / `PASSWORD_NOT_SET` there.

Features that need an email (team invitations, account emails) skip or explain when a phone-only
account has none, rather than failing.

## Configuration (names only)

`ARKESEL_API_KEY`, `ARKESEL_SENDER_ID` (3–11 chars, approved in the Arkesel dashboard),
optional `ARKESEL_OTP_EXPIRY_MINUTES` / `ARKESEL_OTP_LENGTH`, `OTP_HASH_SECRET`, optional `OTP_SMS_GLOBAL_HOURLY_LIMIT`,
`RESEND_API_KEY`, `SESSION_SECRET`.
