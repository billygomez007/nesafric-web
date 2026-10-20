import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requirePlatformPrincipal } from "@/platform/platform-admin/auth";
import { resolveLocationForPlatform } from "@/modules/geography/admin";

export async function POST(request: Request, { params }: { params: Promise<{ locationId: string }> }) {
  try {
    const principal = await requirePlatformPrincipal(await requireUser());
    return NextResponse.json(await resolveLocationForPlatform(principal, (await params).locationId, await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
}
