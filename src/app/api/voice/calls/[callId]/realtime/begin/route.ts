import { NextResponse } from "next/server";
import { requireVoiceProviderRequest } from "@/modules/voice/provider-auth";
import { errorResponse } from "@/platform/errors";
import { beginRealtimeSession } from "@/modules/voice/service";

type Context = { params: Promise<{ callId: string }> };

/** Opens the item 3 streaming-session state machine for an already-answered call and announces the
 * configured opening disclosure (item 12), if any. */
export async function POST(request: Request, { params }: Context) {
  try {
    requireVoiceProviderRequest(request);
    return NextResponse.json(await beginRealtimeSession((await params).callId), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
