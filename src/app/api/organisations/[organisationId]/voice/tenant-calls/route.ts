import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { placeOutboundTenantCall } from "@/modules/voice/service";

type Context = { params: Promise<{ organisationId: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    const user = await requireUser();
    return NextResponse.json(await placeOutboundTenantCall(user.id, (await params).organisationId, await request.json()), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
