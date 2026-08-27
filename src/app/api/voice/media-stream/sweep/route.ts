import { NextResponse } from "next/server";
import { errorResponse, AppError } from "@/platform/errors";
import { sweepOrphanedMediaStreams } from "@/modules/voice/media-bridge";

/**
 * Item 12/17's orphan-cleanup sweep, global across every organisation (a periodic scheduler's
 * job, not an organisation-scoped operator action). Guarded by an optional shared secret — only
 * enforced when `VOICE_MEDIA_SWEEP_SECRET` is actually configured, so this environment (no such
 * secret exists) keeps working without inventing one, exactly like every other credential in this
 * codebase.
 */
export async function POST(request: Request) {
  try {
    const configuredSecret = process.env.VOICE_MEDIA_SWEEP_SECRET?.trim();
    if (configuredSecret) {
      const provided = request.headers.get("x-voice-sweep-secret");
      if (provided !== configuredSecret) throw new AppError("VOICE_SWEEP_UNAUTHORIZED", 401, "Invalid sweep secret.");
    }
    const result = await sweepOrphanedMediaStreams();
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
