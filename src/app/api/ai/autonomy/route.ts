import { NextResponse } from "next/server";
import { getAutonomyState, updateAutonomyConfiguration } from "@/modules/ai-autonomy/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

export async function GET(request: Request) {
  try {
    return NextResponse.json(await getAutonomyState((await requireUser()).id, requireOrganisationId(request)));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    return NextResponse.json(await updateAutonomyConfiguration(
      (await requireUser()).id,
      requireOrganisationId(request),
      await request.json(),
    ));
  } catch (error) {
    return errorResponse(error);
  }
}
