import { NextResponse } from "next/server";
import { errorResponse } from "@/platform/errors";
import { submitMediaStreamFrame } from "@/modules/voice/media-bridge";
import { mediaStreamFrameSchema } from "@/modules/voice/schemas";

/** One authenticated audio frame in, one STT->routing->TTS result out (item 1/2/3). */
export async function POST(request: Request) {
  try {
    const data = mediaStreamFrameSchema.parse(await request.json());
    const result = await submitMediaStreamFrame(data.streamToken, { audioChunkBase64: data.audioChunkBase64, simulatedText: data.simulatedText, isFinalChunk: data.isFinalChunk });
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
