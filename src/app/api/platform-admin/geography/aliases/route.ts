import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requirePlatformPrincipal } from "@/platform/platform-admin/auth";
import { addGeoAlias } from "@/modules/geography/admin";

export async function POST(request: Request) {
  try {
    const principal = await requirePlatformPrincipal(await requireUser());
    return NextResponse.json(await addGeoAlias(principal, await request.json()), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
