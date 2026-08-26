import { NextResponse } from "next/server";
import { createAISession, listAISessions } from "@/modules/ai/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

export async function GET(request: Request) {
  try {
    return NextResponse.json(
      await listAISessions((await requireUser()).id, requireOrganisationId(request)),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    return NextResponse.json(
      await createAISession(
        (await requireUser()).id,
        requireOrganisationId(request),
        await request.json(),
      ),
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
