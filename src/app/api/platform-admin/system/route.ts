import { NextResponse } from "next/server";
import { getPublicHealth } from "@/modules/health/service";
import { getPlatformHealth } from "@/modules/platform-admin/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requirePlatformPrincipal } from "@/platform/platform-admin/auth";

export async function GET() {
  try {
    const principal = await requirePlatformPrincipal(await requireUser());

    const [runtime, operations] = await Promise.all([
      getPublicHealth(),
      getPlatformHealth(principal),
    ]);

    return NextResponse.json({
      runtime,
      operations,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
