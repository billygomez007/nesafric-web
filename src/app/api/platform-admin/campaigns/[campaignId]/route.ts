import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requirePlatformPrincipal } from "@/platform/platform-admin/auth";
import { getCampaignForPlatform, updatePlatformCampaign } from "@/modules/campaigns/service";

type Context = { params: Promise<{ campaignId: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const principal = await requirePlatformPrincipal(await requireUser());
    return NextResponse.json(await getCampaignForPlatform(principal, (await params).campaignId));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const principal = await requirePlatformPrincipal(await requireUser());
    return NextResponse.json(await updatePlatformCampaign(principal, (await params).campaignId, await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
}
