import { NextResponse } from "next/server";
import { listAIActivities } from "@/modules/ai-autonomy/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    return NextResponse.json(await listAIActivities(
      (await requireUser()).id,
      requireOrganisationId(request),
      Object.fromEntries(url.searchParams),
    ));
  } catch (error) {
    return errorResponse(error);
  }
}
