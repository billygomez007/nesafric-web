import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { placeOutboundProspectCall } from "@/modules/voice/service";

type Context = { params: Promise<{ professionalId: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    const user = await requireUser();
    return NextResponse.json(await placeOutboundProspectCall(user.id, (await params).professionalId, await request.json()), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
