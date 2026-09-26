import { NextResponse } from "next/server";
import { reorderHomepageCompanyLogos } from "@/modules/platform-admin/homepage-media-service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requirePlatformPrincipal } from "@/platform/platform-admin/auth";

/** Replaces the whole rail order in one transaction: `{ "ids": ["<homepage item id>", ...] }`. */
export async function PUT(request: Request) {
  try {
    const user = await requireUser();
    const principal = await requirePlatformPrincipal(user);

    return NextResponse.json(
      await reorderHomepageCompanyLogos(principal, user.id, await request.json()),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
