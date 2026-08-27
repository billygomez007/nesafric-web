import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { listPhoneNumbers, createPhoneNumber } from "@/modules/voice/phone-numbers";

type Context = { params: Promise<{ organisationId: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const user = await requireUser();
    return NextResponse.json(await listPhoneNumbers(user.id, (await params).organisationId));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const user = await requireUser();
    return NextResponse.json(await createPhoneNumber(user.id, (await params).organisationId, await request.json()), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
