import { NextResponse } from "next/server";
import { listChannelConfigs } from "@/modules/conversations/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";

type Context = { params: Promise<{ organisationId: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    return NextResponse.json(await listChannelConfigs((await requireUser()).id, (await params).organisationId));
  } catch (error) {
    return errorResponse(error);
  }
}
