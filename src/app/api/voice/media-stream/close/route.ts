import { NextResponse } from "next/server";
import { errorResponse } from "@/platform/errors";
import { closeMediaStream } from "@/modules/voice/media-bridge";
import { mediaStreamCloseSchema } from "@/modules/voice/schemas";

export async function POST(request: Request) {
  try {
    const data = mediaStreamCloseSchema.parse(await request.json());
    const result = await closeMediaStream(data.streamToken, data.reason ?? "bridge_closed");
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
