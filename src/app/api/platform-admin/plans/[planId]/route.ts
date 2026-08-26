import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requirePlatformPrincipal } from "@/platform/platform-admin/auth";
import { updatePlan } from "@/modules/platform-admin/service";

type Context = { params: Promise<{ planId: string }> };

export async function PUT(request: Request, { params }: Context) {
  try {
    const principal = await requirePlatformPrincipal(await requireUser());
    const { planId } = await params;
    return NextResponse.json(await updatePlan(principal, planId, await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
}
