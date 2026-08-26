import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requirePlatformPrincipal } from "@/platform/platform-admin/auth";
import { listOrganisationsForPlatform } from "@/modules/platform-admin/service";

/** Safe aggregate organisation listing for the platform-admin dashboard (item 8). */
export async function GET(request: Request) {
  try {
    const principal = await requirePlatformPrincipal(await requireUser());
    const url = new URL(request.url);
    const query = { status: url.searchParams.get("status") ?? undefined, search: url.searchParams.get("search") ?? undefined };
    return NextResponse.json(await listOrganisationsForPlatform(principal, query));
  } catch (error) {
    return errorResponse(error);
  }
}
