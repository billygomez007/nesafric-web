import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requirePlatformPrincipal } from "@/platform/platform-admin/auth";
import { listUnresolvedLocations } from "@/modules/geography/admin";

export async function GET(request: Request) {
  try {
    const principal = await requirePlatformPrincipal(await requireUser());
    return NextResponse.json(await listUnresolvedLocations(principal, Object.fromEntries(new URL(request.url).searchParams)));
  } catch (error) {
    return errorResponse(error);
  }
}
