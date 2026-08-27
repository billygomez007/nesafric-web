import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { getVoiceAnalytics } from "@/modules/voice/service";

type Context = { params: Promise<{ organisationId: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const user = await requireUser();
    return NextResponse.json(await getVoiceAnalytics(user.id, (await params).organisationId));
  } catch (error) {
    return errorResponse(error);
  }
}
