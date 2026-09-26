import { NextResponse } from "next/server";
import { requireVoiceProviderRequest } from "@/modules/voice/provider-auth";
import { errorResponse } from "@/platform/errors";
import { finishAISpeaking } from "@/modules/voice/service";

type Context = { params: Promise<{ callId: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    requireVoiceProviderRequest(request);
    return NextResponse.json(await finishAISpeaking((await params).callId));
  } catch (error) {
    return errorResponse(error);
  }
}
