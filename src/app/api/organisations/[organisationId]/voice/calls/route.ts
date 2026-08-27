import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { listVoiceCalls } from "@/modules/voice/service";

type Context = { params: Promise<{ organisationId: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const user = await requireUser();
    const query = Object.fromEntries(new URL(request.url).searchParams);
    return NextResponse.json(await listVoiceCalls(user.id, (await params).organisationId, query));
  } catch (error) {
    return errorResponse(error);
  }
}
