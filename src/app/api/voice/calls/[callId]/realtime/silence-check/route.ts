import { NextResponse } from "next/server";
import { requireVoiceProviderRequest } from "@/modules/voice/provider-auth";
import { errorResponse } from "@/platform/errors";
import { checkCallSilence } from "@/modules/voice/service";

type Context = { params: Promise<{ callId: string }> };

/** Item 3's silence-detection polling entrypoint — a real audio bridge calls this on a timer. */
export async function POST(request: Request, { params }: Context) {
  try {
    requireVoiceProviderRequest(request);
    return NextResponse.json(await checkCallSilence((await params).callId));
  } catch (error) {
    return errorResponse(error);
  }
}
