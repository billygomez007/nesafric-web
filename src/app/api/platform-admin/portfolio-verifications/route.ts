import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requirePlatformPrincipal } from "@/platform/platform-admin/auth";
import { listPortfolioVerificationsForPlatform } from "@/modules/platform-admin/service";

export async function GET(request: Request) {
  try {
    const principal = await requirePlatformPrincipal(await requireUser());
    const status = new URL(request.url).searchParams.get("status");
    return NextResponse.json(await listPortfolioVerificationsForPlatform(principal, status === "VERIFIED" || status === "REJECTED" ? status : "PENDING"));
  } catch (error) {
    return errorResponse(error);
  }
}
