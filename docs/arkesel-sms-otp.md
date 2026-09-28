# Arkesel SMS and SMS one-time codes

NesAfric sends SMS and phone sign-in codes through [Arkesel](https://sms.arkesel.com), using its
documented REST API (API spec v2.4.0) from the backend only. Browsers and the mobile app call
NesAfric; they never call Arkesel and never see the API key.

## Architecture

```
web / mobile ──► POST /api/auth/otp/request ─┐
                 POST /api/auth/(mobile/)otp/verify
                                              ▼
              src/modules/identity/otp.ts   (rate limits, attempts, single use, accounts, sessions)
                                              │ SMS only
                                              ▼
              src/modules/messaging/otp-provider.ts   (SmsOtpProvider seam; mocked in tests)
              src/modules/messaging/arkesel-client.ts (typed client, error mapping, redacted logs)
              src/modules/messaging/config.ts         (env validation, fails closed)
              src/modules/messaging/sms.ts            (sendTransactionalSms, not wired yet)
```

- **SMS codes: Arkesel is the authority.** It generates, texts, expires and checks the code.
  NesAfric never sees a code before the person types it and never generates SMS codes itself.
- **NesAfric still owns** the send and guess limits, single use, account creation, `phoneVerifiedAt`
  and sessions. Arkesel doesn't document whether a verified code can be verified again or whether a
  newer code cancels an older one, so NesAfric enforces both itself. Once Arkesel confirms a code,
  NesAfric stores only its HMAC, so a repeat check (for example "create the account" after "no
  account uses this number") happens locally.
- **Email codes** stay NesAfric-generated (Arkesel OTP only supports SMS and voice).
- The older provider-neutral `SmsChannelAdapter` (conversations inbox, `SMS_PROVIDER_*`) is
  separate and unchanged.

## Endpoints used

| Operation | Request | Success |
| --- | --- | --- |
| Generate OTP | `POST https://sms.arkesel.com/api/otp/generate` `{ expiry: 5, length: 6, medium: "sms", message: "…%otp_code%…", number: "233…", sender_id, type: "numeric" }` | `code: "1000"` |
| Verify OTP | `POST https://sms.arkesel.com/api/otp/verify` `{ code, number: "233…" }` | `code: "1100"` |
| Send SMS | `POST https://sms.arkesel.com/api/v2/sms/send` `{ sender, message, recipients: ["233…"], sandbox? }` | `status: "success"` and our recipient in `data` |

Headers: `api-key: <ARKESEL_API_KEY>`, `Content-Type: application/json`. Timeout 15 s.
Numbers are stored and handled as E.164 (`+233241234567`) and sent to Arkesel as digits (`233241234567`).

## Environment variables (server-only)

| Name | Required | Notes |
| --- | --- | --- |
| `ARKESEL_API_KEY` | yes | From the Arkesel dashboard (SMS API). Never `NEXT_PUBLIC_` / `EXPO_PUBLIC_`. |
| `ARKESEL_SENDER_ID` | yes | 3–11 letters, digits or spaces. **Must be approved in the Arkesel account first.** No default. |
| `ARKESEL_OTP_EXPIRY_MINUTES` | no | 1–10, default 5. |
| `ARKESEL_OTP_LENGTH` | no | Only `6` is accepted (the web and app code fields are 6 digits). |
| `OTP_HASH_SECRET` | recommended | ≥ 32 chars; HMAC key for stored digests (falls back to `SESSION_SECRET`). |
| `OTP_SMS_GLOBAL_HOURLY_LIMIT` | no | Platform-wide SMS code ceiling per hour, default 1000. |

If either required value is missing or invalid, phone codes return `503 OTP_SMS_UNAVAILABLE` and
nothing is sent. `/api/health` shows `smsOtp: CONFIGURED | UNCONFIGURED` (no secrets).

### Sender ID requirement

Arkesel delivers only from a sender ID registered and approved on the account. An unapproved ID is
rejected (Arkesel `1003`) or dropped by networks. Get the ID (e.g. `NesAfric`) approved in the Arkesel
dashboard **before** setting it in production. NesAfric never substitutes `Arkesel` or any default.

## Phone numbers

`normalizePhone()` (`src/platform/identity/phone.ts`, libphonenumber full metadata): Ghana is the
default region (`024 123 4567`, `0241234567`, `233241234567` → `+233241234567`); other countries
only when written with `+` or `00`. Impossible numbers, landlines, toll-free and premium numbers are
rejected before anything is sent.

## Limits and abuse protection

- Send: 1 per 60 s and 5 per hour per number; 20 per hour per client IP (trusted IP only — on Vercel,
  or `TRUSTED_CLIENT_IP_HEADER`); `OTP_SMS_GLOBAL_HOURLY_LIMIT` per hour platform-wide.
- Verify: 5 wrong codes per challenge (then Arkesel isn't even asked), 10 per number per hour.
- The same answer is returned for any valid number, whether or not it has an account.
- `sendTransactionalSms` accepts at most 10 recipients per call and isn't exposed by any public route.

## Errors

| Arkesel | Internal (`MessagingError`) | Public answer |
| --- | --- | --- |
| HTTP 401/403, `1001`, `1002`, `1004`, `1009` | `CONFIGURATION` | 503 "Text-message codes are temporarily unavailable…" |
| `1003`, 422 sender errors | `SENDER_ID` | same 503 |
| HTTP 402, `1007`, `1008` | `INSUFFICIENT_BALANCE` | same 503 |
| `1005`, `1006`, `1102`, `1103` | `INVALID_PHONE` | 400 "We can’t send a text message to this number…" |
| HTTP 429 | `RATE_LIMITED` | 429 |
| HTTP 5xx, `1011`, `1106`, network, timeout | `PROVIDER_UNAVAILABLE` | 503 (verify: "We couldn’t check your code…", no attempt counted) |
| Unexpected 2xx body | `MALFORMED_RESPONSE` | 503 |
| `1104` | — | 400 `OTP_INVALID` (attempt counted) |
| `1105` | — | 400 `OTP_EXPIRED` "That code has expired…" (challenge closed) |

Raw Arkesel bodies are never returned to users.

## Logging

One JSON line per Arkesel call (`event: "messaging.arkesel"`): correlation id, operation, masked
number (`+233 24 *** 4567`), HTTP status, Arkesel code, outcome, duration, and the provider's message
with digit runs redacted. Never the API key, a code, a message body or a full number.

## Delivery callbacks

Arkesel's SMS v2 `callback_url` can report delivery status, but Arkesel documents **no signature or
authentication** for these callbacks (signed webhooks exist only for its IVR product), and OTP
generation has no callback. A public unauthenticated endpoint would accept forged statuses, so
none is implemented. Sign-in correctness never depends on delivery reports. If needed later: a
per-message unguessable token in the callback URL, idempotent storage of status only.

## Local testing

Automated tests never call Arkesel: `ArkeselClient` takes an injected `fetch`, and the integration
suite replaces `getSmsOtpProvider` with a fake code authority. Run:

```bash
npx vitest run tests/messaging-arkesel.unit.test.ts tests/phone-normalization.unit.test.ts
scripts/create-isolated-test-database.sh nesafric_release_20260928_verify_test
DATABASE_URL='postgresql://propertyos@localhost:5432/nesafric_release_20260928_verify_test?schema=public' npx vitest run tests/postgres-auth-otp.integration.test.ts
```

For manual SMS checks without cost, `sendTransactionalSms({ …, sandbox: true })` uses Arkesel's
unbilled sandbox (messages appear only in the Arkesel SMS history). The OTP API has no sandbox.

## Production setup (Vercel)

Add to the Vercel project's Production (and Preview, if phone sign-in should work there)
environment: `ARKESEL_API_KEY`, `ARKESEL_SENDER_ID`, and ideally `OTP_HASH_SECRET`. Redeploy.
Then confirm `/api/health` → `smsOtp: CONFIGURED`.

## Live test checklist (manual, one number, stop after one success)

1. Confirm `ARKESEL_API_KEY` is set in the approved test environment (never paste it anywhere else).
2. Confirm `ARKESEL_SENDER_ID` is approved in the Arkesel dashboard.
3. Use one explicitly authorised test phone.
4. Request a code: sign in → Phone → the number → Send code.
5. Confirm the SMS arrives, from the approved sender ID, saying "expires in 5 minutes".
6. Enter the code → signed in.
7. Confirm the account's `phoneVerifiedAt` is set (Platform Admin → Users shows "Phone verified").
8. Confirm the logs contain only masked numbers and no code or key (`messaging.arkesel` lines).
9. Confirm "Resend in …s" and that an immediate second request is refused (429).
10. Stop. No bulk SMS.

## Rollback

Unset `ARKESEL_API_KEY` (or `ARKESEL_SENDER_ID`) and redeploy: phone codes are then refused with a
clear 503 and people can use email or Google. Nothing else changes; no data needs reverting.
