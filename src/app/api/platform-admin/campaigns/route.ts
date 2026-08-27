import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requirePlatformPrincipal } from "@/platform/platform-admin/auth";
import { createPlatformCampaign, listCampaignsForPlatform } from "@/modules/campaigns/service";

export async function GET(request: Request) {
  try {
    const principal = await requirePlatformPrincipal(await requireUser());
    const query = Object.fromEntries(new URL(request.url).searchParams);
    return NextResponse.json(await listCampaignsForPlatform(principal, query));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const principal = await requirePlatformPrincipal(await requireUser());
    return NextResponse.json(await createPlatformCampaign(principal, await request.json()), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
