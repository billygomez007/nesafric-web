import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { proposeAndCallArtisan } from "@/modules/voice/service";

type Context = { params: Promise<{ organisationId: string }> };

/** Item 6's full pipeline: proposes the next dispatch-hierarchy candidate and places the call. */
export async function POST(request: Request, { params }: Context) {
  try {
    const user = await requireUser();
    return NextResponse.json(await proposeAndCallArtisan(user.id, (await params).organisationId, await request.json()), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
