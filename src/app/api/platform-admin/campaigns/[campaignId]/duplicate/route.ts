import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requirePlatformPrincipal } from "@/platform/platform-admin/auth";
import { duplicateCampaign } from "@/modules/campaigns/service";

export async function POST(_request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  try {
    const principal = await requirePlatformPrincipal(await requireUser());
    return NextResponse.json(await duplicateCampaign(principal, (await params).campaignId), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
