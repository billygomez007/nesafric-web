import { NextResponse } from "next/server";
import { requireVoiceProviderRequest } from "@/modules/voice/provider-auth";
import { errorResponse } from "@/platform/errors";
import { submitCallerAudioChunk } from "@/modules/voice/service";

type Context = { params: Promise<{ callId: string }> };

/** Item 2/3's realtime pipeline entrypoint: one chunk of caller audio (or, in this environment's
 * mock/test transport, its already-known text) in, an STT→routing→TTS result out. */
export async function POST(request: Request, { params }: Context) {
  try {
    requireVoiceProviderRequest(request);
    return NextResponse.json(await submitCallerAudioChunk((await params).callId, await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
}
