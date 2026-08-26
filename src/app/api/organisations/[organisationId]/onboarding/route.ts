import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { getOnboardingChecklist } from "@/modules/onboarding/service";

type Context = { params: Promise<{ organisationId: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const { organisationId } = await params;
    return NextResponse.json(await getOnboardingChecklist((await requireUser()).id, organisationId));
  } catch (error) {
    return errorResponse(error);
  }
}
