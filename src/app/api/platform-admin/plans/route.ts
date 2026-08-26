import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requirePlatformPrincipal } from "@/platform/platform-admin/auth";
import { createPlan, listPlansForPlatform } from "@/modules/platform-admin/service";

export async function GET() {
  try {
    const principal = await requirePlatformPrincipal(await requireUser());
    return NextResponse.json(await listPlansForPlatform(principal));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const principal = await requirePlatformPrincipal(await requireUser());
    return NextResponse.json(await createPlan(principal, await request.json()), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
