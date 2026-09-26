import { NextResponse } from "next/server";
import { requireVoiceProviderRequest } from "@/modules/voice/provider-auth";
import { errorResponse } from "@/platform/errors";
import { getTenantCallSummary } from "@/modules/voice/service";

type Context = { params: Promise<{ callId: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    requireVoiceProviderRequest(request);
    return NextResponse.json(await getTenantCallSummary((await params).callId));
  } catch (error) {
    return errorResponse(error);
  }
}
