import { NextResponse } from "next/server";
import { requireVoiceProviderRequest } from "@/modules/voice/provider-auth";
import { errorResponse } from "@/platform/errors";
import { qualifyVoiceLead } from "@/modules/voice/service";

type Context = { params: Promise<{ callId: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    requireVoiceProviderRequest(request);
    return NextResponse.json(await qualifyVoiceLead((await params).callId, await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
}
