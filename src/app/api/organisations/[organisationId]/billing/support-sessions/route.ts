import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { listVisibleSupportSessions } from "@/modules/subscriptions/service";

type Context = { params: Promise<{ organisationId: string }> };

/** Item 9's "visible session": the organisation's own view of platform support access to their data. */
export async function GET(_request: Request, { params }: Context) {
  try {
    const { organisationId } = await params;
    return NextResponse.json(await listVisibleSupportSessions((await requireUser()).id, organisationId));
  } catch (error) {
    return errorResponse(error);
  }
}
