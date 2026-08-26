import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requirePlatformPrincipal } from "@/platform/platform-admin/auth";
import { getPlatformAuditLog } from "@/modules/platform-admin/service";

export async function GET(request: Request) {
  try {
    const principal = await requirePlatformPrincipal(await requireUser());
    const url = new URL(request.url);
    const organisationId = url.searchParams.get("organisationId") ?? undefined;
    return NextResponse.json(await getPlatformAuditLog(principal, { organisationId }));
  } catch (error) {
    return errorResponse(error);
  }
}
