import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { changeOrganisationPlan, previewOrganisationPlanChange } from "@/modules/subscriptions/service";

type Context = { params: Promise<{ organisationId: string }> };

/** Preview the conflicts a plan change would cause (item 2's "report conflicts") without applying it. */
export async function GET(request: Request, { params }: Context) {
  try {
    const { organisationId } = await params;
    const planKey = new URL(request.url).searchParams.get("planKey");
    if (!planKey) return NextResponse.json({ error: { code: "PLAN_KEY_REQUIRED", message: "A planKey query parameter is required." } }, { status: 400 });
    const conflicts = await previewOrganisationPlanChange((await requireUser()).id, organisationId, planKey);
    return NextResponse.json({ conflicts });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const { organisationId } = await params;
    const result = await changeOrganisationPlan((await requireUser()).id, organisationId, await request.json());
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
