import { NextResponse } from "next/server";
import { errorResponse } from "@/platform/errors";
import { captureVoiceLead } from "@/modules/voice/service";

type Context = { params: Promise<{ callId: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    return NextResponse.json(await captureVoiceLead((await params).callId, await request.json()), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
