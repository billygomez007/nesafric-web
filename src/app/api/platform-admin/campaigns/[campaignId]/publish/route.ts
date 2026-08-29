import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requirePlatformPrincipal } from "@/platform/platform-admin/auth";
import { publishCampaign } from "@/modules/campaigns/service";

export async function POST(_request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  try {
    const principal = await requirePlatformPrincipal(await requireUser());
    return NextResponse.json(await publishCampaign(principal, (await params).campaignId));
  } catch (error) {
    return errorResponse(error);
  }
}
