import { NextResponse } from "next/server";
import { errorResponse } from "@/platform/errors";
import { finishAISpeaking } from "@/modules/voice/service";

type Context = { params: Promise<{ callId: string }> };

export async function POST(_request: Request, { params }: Context) {
  try {
    return NextResponse.json(await finishAISpeaking((await params).callId));
  } catch (error) {
    return errorResponse(error);
  }
}
