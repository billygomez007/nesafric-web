import { NextResponse } from "next/server";
import { errorResponse } from "@/platform/errors";
import { handleCallerDisconnect } from "@/modules/voice/service";

type Context = { params: Promise<{ callId: string }> };

export async function POST(_request: Request, { params }: Context) {
  try {
    return NextResponse.json(await handleCallerDisconnect((await params).callId));
  } catch (error) {
    return errorResponse(error);
  }
}
