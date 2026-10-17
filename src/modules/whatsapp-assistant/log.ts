import { AppError } from "@/platform/errors";

/**
 * What the assistant may log about an error: its class and, for application errors, the code and
 * status. Never `error.message`: database and validation errors can echo field values, which here
 * means people's messages, names and phone numbers.
 */
export function errorLabel(error: unknown) {
  if (error instanceof AppError) return `${error.name}:${error.code}:${error.status}`;
  return error instanceof Error ? error.name : "unknown";
}
