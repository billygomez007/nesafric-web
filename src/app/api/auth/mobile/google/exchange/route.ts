import { mobileSessionJson } from "@/platform/auth/mobile-session";
import { redeemMobileHandoff } from "@/platform/auth/mobile-handoff";
import { errorResponse } from "@/platform/errors";

export const maxDuration = 30;

/**
 * Redeems the one-time Google handoff code (with the app's PKCE verifier) for the same mobile
 * session response as password sign-in. Single use: a replayed, expired or mis-bound code gets
 * `400 INVALID_HANDOFF`.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    // Consumes the code and creates the session in one locked transaction (see redeemMobileHandoff).
    const { user, session, token } = await redeemMobileHandoff(body?.code, body?.codeVerifier);
    return mobileSessionJson(user, session, token);
  } catch (error) {
    return errorResponse(error);
  }
}
