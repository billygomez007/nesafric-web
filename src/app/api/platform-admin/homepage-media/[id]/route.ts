import { NextResponse } from "next/server";
import {
  deleteHomepageCompanyLogo,
  updateHomepageCompanyLogo,
} from "@/modules/platform-admin/homepage-media-service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requirePlatformPrincipal } from "@/platform/platform-admin/auth";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(
  request: Request,
  context: RouteContext,
) {
  try {
    const user = await requireUser();
    const principal = await requirePlatformPrincipal(user);
    const { id } = await context.params;
    const input = await request.json();

    return NextResponse.json(
      await updateHomepageCompanyLogo(principal, user.id, id, input),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  context: RouteContext,
) {
  try {
    const user = await requireUser();
    const principal = await requirePlatformPrincipal(user);
    const { id } = await context.params;

    return NextResponse.json(
      await deleteHomepageCompanyLogo(principal, id),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
