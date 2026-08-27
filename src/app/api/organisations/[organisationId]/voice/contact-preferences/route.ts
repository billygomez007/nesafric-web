import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { listContactPreferences, setVoiceContactPreference } from "@/modules/voice/service";

type Context = { params: Promise<{ organisationId: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const user = await requireUser();
    return NextResponse.json(await listContactPreferences(user.id, (await params).organisationId));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const user = await requireUser();
    return NextResponse.json(await setVoiceContactPreference(user.id, (await params).organisationId, await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
}
