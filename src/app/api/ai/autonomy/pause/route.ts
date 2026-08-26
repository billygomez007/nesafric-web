import { NextResponse } from "next/server";
import { setAutomationPaused } from "@/modules/ai-autonomy/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

export async function PATCH(request: Request) {
  try {
    return NextResponse.json(await setAutomationPaused(
      (await requireUser()).id,
      requireOrganisationId(request),
      await request.json(),
    ));
  } catch (error) {
    return errorResponse(error);
  }
}
