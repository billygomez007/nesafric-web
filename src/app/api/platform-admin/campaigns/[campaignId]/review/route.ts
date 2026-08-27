import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requirePlatformPrincipal } from "@/platform/platform-admin/auth";
import { reviewCampaign } from "@/modules/campaigns/service";

type Context = { params: Promise<{ campaignId: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    const principal = await requirePlatformPrincipal(await requireUser());
    return NextResponse.json(await reviewCampaign(principal, (await params).campaignId, await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
}
