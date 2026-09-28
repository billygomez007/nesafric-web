/**
 * Provider-neutral messaging failures. `message` is always safe to log and never contains the API
 * key, a one-time code, a phone number or a raw provider response body; callers turn these into
 * their own user-facing wording.
 */
export type MessagingErrorCode =
  | "CONFIGURATION"
  | "SENDER_ID"
  | "INSUFFICIENT_BALANCE"
  | "INVALID_PHONE"
  | "RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "MALFORMED_RESPONSE";

export class MessagingError extends Error {
  constructor(
    readonly code: MessagingErrorCode,
    message: string,
    readonly details: { provider: "arkesel"; providerCode?: string; httpStatus?: number; retryable: boolean } = { provider: "arkesel", retryable: false },
  ) {
    super(message);
    this.name = "MessagingError";
  }
}

export const isMessagingError = (error: unknown): error is MessagingError => error instanceof MessagingError;
