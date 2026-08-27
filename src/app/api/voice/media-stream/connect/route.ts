import { NextResponse } from "next/server";
import { errorResponse } from "@/platform/errors";
import { authenticateMediaStream } from "@/modules/voice/media-bridge";
import { mediaStreamConnectSchema } from "@/modules/voice/schemas";

/**
 * Item 2's authentication boundary as HTTP: whoever presents a valid, provider-issued
 * `streamToken` is the only party ever trusted, regardless of anything else in the request body.
 * Never accepts a caller-supplied `callId`/`organisationId` — those are always resolved from the
 * token server-side. Called by the deployed media-bridge process the instant the telephony
 * provider's real-time connection reaches it (see `media-bridge.ts`'s module doc comment for why
 * that process cannot be a Next.js route handler itself).
 */
export async function POST(request: Request) {
  try {
    const { streamToken } = mediaStreamConnectSchema.parse(await request.json());
    const result = await authenticateMediaStream(streamToken);
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
