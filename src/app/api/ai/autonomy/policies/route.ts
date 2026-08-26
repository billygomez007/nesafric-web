import { NextResponse } from "next/server";
import { upsertAutonomyPolicy } from "@/modules/ai-autonomy/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

export async function POST(request: Request) {
  try {
    return NextResponse.json(await upsertAutonomyPolicy(
      (await requireUser()).id,
      requireOrganisationId(request),
      await request.json(),
    ));
  } catch (error) {
    return errorResponse(error);
  }
}
