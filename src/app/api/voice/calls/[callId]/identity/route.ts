import { NextResponse } from "next/server";
import { errorResponse } from "@/platform/errors";
import { verifyVoiceCallerIdentity } from "@/modules/voice/service";

type Context = { params: Promise<{ callId: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    return NextResponse.json(await verifyVoiceCallerIdentity((await params).callId, await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
}
