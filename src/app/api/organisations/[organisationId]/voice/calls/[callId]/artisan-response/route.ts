import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { recordArtisanCallResponse } from "@/modules/voice/service";

type Context = { params: Promise<{ organisationId: string; callId: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    const user = await requireUser();
    const { organisationId, callId } = await params;
    return NextResponse.json(await recordArtisanCallResponse(user.id, organisationId, callId, await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
}
