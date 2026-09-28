import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requirePlatformPrincipal } from "@/platform/platform-admin/auth";
import { getPlacementRotationForPlatform, setPlacementRotation } from "@/modules/campaigns/rotation";

type Context = { params: Promise<{ placement: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const principal = await requirePlatformPrincipal(await requireUser());
    return NextResponse.json(await getPlacementRotationForPlatform(principal, (await params).placement));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request, { params }: Context) {
  try {
    const principal = await requirePlatformPrincipal(await requireUser());
    return NextResponse.json(await setPlacementRotation(principal, (await params).placement, await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
}
