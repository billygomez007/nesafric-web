import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requirePlatformPrincipal } from "@/platform/platform-admin/auth";
import { updateFeatureFlag } from "@/modules/platform-admin/service";

type Context = { params: Promise<{ flagKey: string }> };

export async function PUT(request: Request, { params }: Context) {
  try {
    const principal = await requirePlatformPrincipal(await requireUser());
    const { flagKey } = await params;
    return NextResponse.json(await updateFeatureFlag(principal, flagKey, await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
}
