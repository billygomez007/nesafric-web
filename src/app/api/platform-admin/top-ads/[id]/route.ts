import { NextResponse } from "next/server";
import { deleteTopAd, updateTopAd } from "@/modules/marketplace/top-ads";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requirePlatformPrincipal } from "@/platform/platform-admin/auth";

type RouteContext = { params: Promise<{ id: string }> };

/** `{ isActive?, startsAt?, endsAt? }` (null clears a date). */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const principal = await requirePlatformPrincipal(user);
    const { id } = await context.params;
    return NextResponse.json(await updateTopAd(principal, user.id, id, await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const principal = await requirePlatformPrincipal(await requireUser());
    const { id } = await context.params;
    return NextResponse.json(await deleteTopAd(principal, id));
  } catch (error) {
    return errorResponse(error);
  }
}
