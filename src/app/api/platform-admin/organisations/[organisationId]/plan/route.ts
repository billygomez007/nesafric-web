import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requirePlatformPrincipal } from "@/platform/platform-admin/auth";
import { forcePlanChange, previewForcedPlanChange } from "@/modules/platform-admin/service";

type Context = { params: Promise<{ organisationId: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const principal = await requirePlatformPrincipal(await requireUser());
    const { organisationId } = await params;
    const planKey = new URL(request.url).searchParams.get("planKey");
    if (!planKey) return NextResponse.json({ error: { code: "PLAN_KEY_REQUIRED", message: "A planKey query parameter is required." } }, { status: 400 });
    return NextResponse.json({ conflicts: await previewForcedPlanChange(principal, organisationId, planKey) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const principal = await requirePlatformPrincipal(await requireUser());
    const { organisationId } = await params;
    return NextResponse.json(await forcePlanChange(principal, organisationId, await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
}
