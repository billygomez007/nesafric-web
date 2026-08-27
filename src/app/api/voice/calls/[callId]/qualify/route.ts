import { NextResponse } from "next/server";
import { errorResponse } from "@/platform/errors";
import { qualifyVoiceLead } from "@/modules/voice/service";

type Context = { params: Promise<{ callId: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    return NextResponse.json(await qualifyVoiceLead((await params).callId, await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
}
