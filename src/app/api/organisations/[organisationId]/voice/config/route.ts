import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { getVoiceProviderConfig, configureVoiceProvider } from "@/modules/voice/service";

type Context = { params: Promise<{ organisationId: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const user = await requireUser();
    return NextResponse.json(await getVoiceProviderConfig(user.id, (await params).organisationId));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const user = await requireUser();
    return NextResponse.json(await configureVoiceProvider(user.id, (await params).organisationId, await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
}
