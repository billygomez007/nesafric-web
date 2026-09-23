export const AUTH_RETURN_TO_COOKIE =
  "nesafric_auth_return_to";

export const AUTH_RETURN_TO_MAX_AGE_SECONDS =
  10 * 60;

export function safeReturnTo(
  value: string | null | undefined,
): string | null {
  if (!value) {
    return null;
  }

  const candidate = value.trim();

  if (
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\") ||
    candidate.includes("\r") ||
    candidate.includes("\n")
  ) {
    return null;
  }

  return candidate;
}

export function authReturnToCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: AUTH_RETURN_TO_MAX_AGE_SECONDS,
  };
}
