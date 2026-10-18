import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";
import { manualDispatch } from "@/modules/maintenance-routing/oversight";

type Context = { params: Promise<{ requestId: string }> };

/** Send the job to a chosen network provider, overriding the routing rules. */
export async function POST(request: Request, { params }: Context) {
  try {
    return NextResponse.json(await manualDispatch((await requireUser()).id, requireOrganisationId(request), (await params).requestId, await request.json()), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
