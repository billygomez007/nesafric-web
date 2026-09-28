import { API_REDIRECTED, ApiError, NETWORK_ERROR, SERVICE_ROUTE_MISSING, SERVICE_UNAVAILABLE } from "@/api/client";
import { GoogleSignInError } from "./google";

/**
 * Readable copy for sign-in and sign-up failures. The server stays the authority and its error
 * `code` is kept on the `ApiError` for diagnosis and tests; only the wording shown is chosen here.
 * Never shows SQL, stack traces, provider names, tokens or infrastructure details.
 */
const MESSAGES: Record<string, string> = {
  // Email codes (Resend).
  OTP_EMAIL_UNAVAILABLE: "Email verification is temporarily unavailable. Please try again later.",
  INVALID_EMAIL: "Enter a valid email address.",
  // Phone codes (Arkesel).
  OTP_SMS_UNAVAILABLE: "We couldn’t send a verification code to that phone number. Please use email or try again later.",
  INVALID_PHONE: "Enter a valid Ghana phone number, for example 024 123 4567 or +233 24 123 4567.",
  // Either channel.
  OTP_UNAVAILABLE: "Sign-in codes are temporarily unavailable. Please try again later.",
  OTP_VERIFY_UNAVAILABLE: "We couldn’t check your code right now. Please try again in a moment.",
  VALIDATION_ERROR: "Check what you entered and try again.",
  // Google.
  GOOGLE_NOT_CONFIGURED: "Google sign-in is not configured correctly. Please use email or phone for now.",
  // The deployed API doesn't have this sign-in route, or is down.
  [SERVICE_ROUTE_MISSING]: "Sign-in isn’t available right now. Please try again later.",
  [SERVICE_UNAVAILABLE]: "NesAfric is temporarily unavailable. Please try again in a moment.",
  // Deliberately the same for an unknown email, a wrong password and a Google-only account, so
  // the app never reveals which accounts exist.
  INVALID_CREDENTIALS: "That email and password don’t match. Check them and try again, or use Continue with Google if you signed up with Google.",
};

export function signInErrorMessage(error: unknown) {
  if (error instanceof GoogleSignInError) return error.message;
  if (error instanceof ApiError) {
    if (error.code === NETWORK_ERROR) return "Can’t reach NesAfric. Check your connection and try again.";
    if (error.code === API_REDIRECTED) return error.message;
    // Wrong or expired codes, rate limits (the server says how long to wait), "no account",
    // "already in use" and similar: the server's own copy is specific and safe.
    return MESSAGES[error.code] ?? error.message;
  }
  return "Something went wrong. Please try again.";
}
