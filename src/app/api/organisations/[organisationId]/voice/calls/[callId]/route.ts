import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { getVoiceCall } from "@/modules/voice/service";

type Context = { params: Promise<{ organisationId: string; callId: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const user = await requireUser();
    const { organisationId, callId } = await params;
    return NextResponse.json(await getVoiceCall(user.id, organisationId, callId));
  } catch (error) {
    return errorResponse(error);
  }
}
