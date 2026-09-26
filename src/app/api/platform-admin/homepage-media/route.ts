import { NextResponse } from "next/server";
import {
  createHomepageCompanyLogo,
  listHomepageMediaForPlatform,
} from "@/modules/platform-admin/homepage-media-service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requirePlatformPrincipal } from "@/platform/platform-admin/auth";

export async function GET() {
  try {
    const user = await requireUser();
    const principal = await requirePlatformPrincipal(user);

    return NextResponse.json(
      await listHomepageMediaForPlatform(principal),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const principal = await requirePlatformPrincipal(user);
    const input = await request.json();

    return NextResponse.json(
      await createHomepageCompanyLogo(principal, user.id, input),
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
