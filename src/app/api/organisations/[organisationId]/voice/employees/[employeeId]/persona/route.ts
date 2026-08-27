import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { getVoicePersonaConfig, setVoicePersonaConfig } from "@/modules/voice/persona";

type Context = { params: Promise<{ organisationId: string; employeeId: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const user = await requireUser();
    const { organisationId, employeeId } = await params;
    return NextResponse.json(await getVoicePersonaConfig(user.id, organisationId, employeeId));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request, { params }: Context) {
  try {
    const user = await requireUser();
    const { organisationId, employeeId } = await params;
    return NextResponse.json(await setVoicePersonaConfig(user.id, organisationId, employeeId, await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
}
