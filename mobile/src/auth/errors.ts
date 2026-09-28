import { API_REDIRECTED, ApiError, NETWORK_ERROR } from "@/api/client";
import { GoogleSignInError } from "./google";

/** Readable copy for the server's sign-in errors (the server stays the authority). */
export function signInErrorMessage(error: unknown) {
  if (error instanceof GoogleSignInError) return error.message;
  if (error instanceof ApiError) {
    if (error.code === NETWORK_ERROR) return "Can’t reach NesAfric. Check your connection and try again.";
    if (error.code === API_REDIRECTED) return error.message;
    // Deliberately the same for an unknown email, a wrong password and a Google-only account, so
    // the app never reveals which accounts exist.
    if (error.code === "INVALID_CREDENTIALS") return "That email and password don’t match. Check them and try again, or use Continue with Google if you signed up with Google.";
    if (error.code === "LOGIN_RATE_LIMITED") return error.message;
    if (error.code === "VALIDATION_ERROR") return "Check what you entered and try again.";
    if (error.code === "INVALID_HANDOFF") return error.message;
    return error.message;
  }
  return "Something went wrong. Please try again.";
}
