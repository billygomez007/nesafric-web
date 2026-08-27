import { NextResponse } from "next/server";
import { errorResponse } from "@/platform/errors";
import { recordCampaignClick } from "@/modules/campaigns/service";

type Context = { params: Promise<{ campaignId: string }> };

export async function POST(_request: Request, { params }: Context) {
  try {
    await recordCampaignClick((await params).campaignId);
    return NextResponse.json({ recorded: true });
  } catch (error) {
    return errorResponse(error);
  }
}
