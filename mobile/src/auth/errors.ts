import { ApiError, NETWORK_ERROR } from "@/api/client";

/** Readable copy for the server's sign-in errors (the server stays the authority). */
export function signInErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code === NETWORK_ERROR) return "Can’t reach NesAfric. Check your connection and try again.";
    if (error.code === "INVALID_CREDENTIALS") return "That email and password don’t match. Check them and try again.";
    if (error.code === "LOGIN_RATE_LIMITED") return error.message;
    if (error.code === "VALIDATION_ERROR") return "Enter a valid email address and your password.";
    return error.message;
  }
  return "Something went wrong. Please try again.";
}
