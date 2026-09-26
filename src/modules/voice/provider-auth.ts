import { timingSafeEqual } from "node:crypto";
import { AppError } from "@/platform/errors";

/**
 * Guards the provider-facing voice call API (`/api/voice/inbound`, `/api/voice/calls/**`). These
 * endpoints are driven by the telephony bridge, never by a browser, and a call id is enough to
 * read call state, capture leads or reach a verified tenant's summary — so every request must
 * carry the shared secret the bridge is configured with.
 *
 * Fails closed: with `VOICE_PROVIDER_API_SECRET` unset the endpoints are disabled (503) rather
 * than open. Signed provider webhooks keep their own per-provider signature check.
 */
export function requireVoiceProviderRequest(request: Request) {
  const configured = process.env.VOICE_PROVIDER_API_SECRET?.trim();
  if (!configured) {
    throw new AppError("VOICE_PROVIDER_NOT_CONFIGURED", 503, "The voice call API is not configured on this deployment.");
  }
  const provided = request.headers.get("x-voice-provider-secret") ?? "";
  const expected = Buffer.from(configured);
  const actual = Buffer.from(provided);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new AppError("VOICE_PROVIDER_UNAUTHORIZED", 401, "The voice provider credentials are missing or invalid.");
  }
}
