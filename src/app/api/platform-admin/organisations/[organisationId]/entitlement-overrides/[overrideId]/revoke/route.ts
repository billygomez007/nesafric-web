import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requirePlatformPrincipal } from "@/platform/platform-admin/auth";
import { revokeEntitlementOverride } from "@/modules/platform-admin/service";

type Context = { params: Promise<{ organisationId: string; overrideId: string }> };

export async function POST(_request: Request, { params }: Context) {
  try {
    const principal = await requirePlatformPrincipal(await requireUser());
    const { organisationId, overrideId } = await params;
    return NextResponse.json(await revokeEntitlementOverride(principal, organisationId, overrideId));
  } catch (error) {
    return errorResponse(error);
  }
}
