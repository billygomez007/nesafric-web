import { verifyOtp } from "@/modules/identity/otp";
import { mobileSessionResponse } from "@/platform/auth/mobile-session";
import { errorResponse } from "@/platform/errors";

export const maxDuration = 30;

/**
 * Mobile: verifies a one-time code and returns the same `MobileSessionResponse` as password and
 * Google sign-in (an ordinary `Session`, token returned once for secure storage).
 */
export async function POST(request: Request) {
  try {
    const { user } = await verifyOtp(await request.json().catch(() => null));
    return await mobileSessionResponse(user);
  } catch (error) {
    return errorResponse(error);
  }
}
