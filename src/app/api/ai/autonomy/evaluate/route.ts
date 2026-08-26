import { NextResponse } from "next/server";
import { enqueueProactiveEvaluation } from "@/modules/ai-autonomy/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

export async function POST(request: Request) {
  try {
    return NextResponse.json(await enqueueProactiveEvaluation(
      (await requireUser()).id,
      requireOrganisationId(request),
    ));
  } catch (error) {
    return errorResponse(error);
  }
}
