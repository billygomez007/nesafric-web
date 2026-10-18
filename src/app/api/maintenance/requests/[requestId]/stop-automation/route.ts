import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";
import { stopAutomation } from "@/modules/maintenance-routing/oversight";

type Context = { params: Promise<{ requestId: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    const body = await request.json().catch(() => ({})) as { reason?: unknown };
    return NextResponse.json(await stopAutomation((await requireUser()).id, requireOrganisationId(request), (await params).requestId, typeof body.reason === "string" ? body.reason : undefined));
  } catch (error) {
    return errorResponse(error);
  }
}
