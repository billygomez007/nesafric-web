import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requirePlatformPrincipal } from "@/platform/platform-admin/auth";
import { listGeoSourcesForPlatform } from "@/modules/geography/admin";

export async function GET() {
  try {
    const principal = await requirePlatformPrincipal(await requireUser());
    return NextResponse.json(await listGeoSourcesForPlatform(principal));
  } catch (error) {
    return errorResponse(error);
  }
}
