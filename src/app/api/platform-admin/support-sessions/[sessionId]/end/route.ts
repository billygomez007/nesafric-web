import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requirePlatformPrincipal } from "@/platform/platform-admin/auth";
import { endSupportSession } from "@/modules/platform-admin/service";

type Context = { params: Promise<{ sessionId: string }> };

export async function POST(_request: Request, { params }: Context) {
  try {
    const principal = await requirePlatformPrincipal(await requireUser());
    const { sessionId } = await params;
    return NextResponse.json(await endSupportSession(principal, sessionId));
  } catch (error) {
    return errorResponse(error);
  }
}
