import { NextResponse } from "next/server";
import { askAI } from "@/modules/ai/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

type Context = { params: Promise<{ sessionId: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    return NextResponse.json(
      await askAI(
        (await requireUser()).id,
        requireOrganisationId(request),
        (await params).sessionId,
        await request.json(),
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
