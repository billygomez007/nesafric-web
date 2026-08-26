import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requirePlatformPrincipal } from "@/platform/platform-admin/auth";
import { createEntitlementOverride } from "@/modules/platform-admin/service";

type Context = { params: Promise<{ organisationId: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    const principal = await requirePlatformPrincipal(await requireUser());
    const { organisationId } = await params;
    return NextResponse.json(await createEntitlementOverride(principal, organisationId, await request.json()), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
