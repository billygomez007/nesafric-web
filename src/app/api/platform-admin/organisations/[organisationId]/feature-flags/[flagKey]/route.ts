import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requirePlatformPrincipal } from "@/platform/platform-admin/auth";
import { setOrganisationFeatureFlagOverride } from "@/modules/platform-admin/service";

type Context = { params: Promise<{ organisationId: string; flagKey: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    const principal = await requirePlatformPrincipal(await requireUser());
    const { organisationId, flagKey } = await params;
    return NextResponse.json(await setOrganisationFeatureFlagOverride(principal, organisationId, flagKey, await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
}
