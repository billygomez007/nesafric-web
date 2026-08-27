import { NextResponse } from "next/server";
import { errorResponse } from "@/platform/errors";
import { beginRealtimeSession } from "@/modules/voice/service";

type Context = { params: Promise<{ callId: string }> };

/** Opens the item 3 streaming-session state machine for an already-answered call and announces the
 * configured opening disclosure (item 12), if any. */
export async function POST(_request: Request, { params }: Context) {
  try {
    return NextResponse.json(await beginRealtimeSession((await params).callId), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
