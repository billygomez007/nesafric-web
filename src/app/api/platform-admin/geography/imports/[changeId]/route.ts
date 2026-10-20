import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requirePlatformPrincipal } from "@/platform/platform-admin/auth";
import { reviewGeoImportChange } from "@/modules/geography/admin";

export async function POST(request: Request, { params }: { params: Promise<{ changeId: string }> }) {
  try {
    const principal = await requirePlatformPrincipal(await requireUser());
    return NextResponse.json(await reviewGeoImportChange(principal, (await params).changeId, await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
}
