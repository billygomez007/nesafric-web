import { NextResponse } from "next/server";
import { getVerificationQueueForPlatform } from "@/modules/platform-admin/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requirePlatformPrincipal } from "@/platform/platform-admin/auth";

export async function GET() {
  try {
    const principal = await requirePlatformPrincipal(await requireUser());

    return NextResponse.json(
      await getVerificationQueueForPlatform(principal),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
