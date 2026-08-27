import { NextResponse } from "next/server";
import { errorResponse } from "@/platform/errors";
import { getTenantCallSummary } from "@/modules/voice/service";

type Context = { params: Promise<{ callId: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    return NextResponse.json(await getTenantCallSummary((await params).callId));
  } catch (error) {
    return errorResponse(error);
  }
}
