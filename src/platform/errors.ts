import { NextResponse } from "next/server";
import { ZodError } from "zod";

export class AppError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    /** Structured, machine-readable context (e.g. entitlement feature/current/limit). Omitted from the response entirely when unset, so every pre-existing error stays byte-identical. */
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const forbidden = () => new AppError("FORBIDDEN", 403, "You do not have permission to perform this action.");
export const unauthenticated = () => new AppError("UNAUTHENTICATED", 401, "Authentication is required.");
export const notFound = () => new AppError("NOT_FOUND", 404, "The requested resource was not found.");

export function errorResponse(error: unknown) {
  if (error instanceof AppError) {
    return NextResponse.json({ error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } }, { status: error.status });
  }
  if (error instanceof ZodError) {
    return NextResponse.json({
      error: {
        code: "VALIDATION_ERROR",
        message: "The request contains invalid input.",
        issues: error.issues.map(({ path, message }) => ({ path: path.join("."), message })),
      },
    }, { status: 400 });
  }
  console.error(error);
  return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } }, { status: 500 });
}
