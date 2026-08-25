import { NextResponse } from "next/server";

export class AppError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const forbidden = () => new AppError("FORBIDDEN", 403, "You do not have permission to perform this action.");
export const unauthenticated = () => new AppError("UNAUTHENTICATED", 401, "Authentication is required.");
export const notFound = () => new AppError("NOT_FOUND", 404, "The requested resource was not found.");

export function errorResponse(error: unknown) {
  if (error instanceof AppError) {
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  }
  console.error(error);
  return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } }, { status: 500 });
}
