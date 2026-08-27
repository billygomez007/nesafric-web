import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { updatePhoneNumber } from "@/modules/voice/phone-numbers";

type Context = { params: Promise<{ organisationId: string; phoneNumberId: string }> };

export async function PATCH(request: Request, { params }: Context) {
  try {
    const user = await requireUser();
    const { organisationId, phoneNumberId } = await params;
    return NextResponse.json(await updatePhoneNumber(user.id, organisationId, phoneNumberId, await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
}
