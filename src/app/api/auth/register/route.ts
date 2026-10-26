import { NextResponse } from "next/server";

/**
 * Retired (security batch 1, M-2 / H-1). This legacy route created password accounts for any email
 * without proving the address, answered `EMAIL_EXISTS` for taken ones, and had no caller left in the
 * web or mobile apps. Accounts are now created with a one-time code (`POST /api/auth/otp/request`,
 * `mode: "register"`) or Google, both of which prove the address first.
 *
 * The request is never read: every caller gets the same answer, so it reveals nothing about which
 * emails have accounts, and nothing is created.
 */
export async function POST(_request: Request) {
  return NextResponse.json(
    {
      error: {
        code: "REGISTRATION_RETIRED",
        message: "Create your NesAfric account with a one-time code sent to your email or phone, or with Google.",
      },
    },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
