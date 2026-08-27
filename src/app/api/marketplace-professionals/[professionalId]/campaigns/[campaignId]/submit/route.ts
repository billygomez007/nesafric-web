import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { submitCampaignForApproval } from "@/modules/campaigns/service";

type Context = { params: Promise<{ professionalId: string; campaignId: string }> };

export async function POST(_request: Request, { params }: Context) {
  try {
    const user = await requireUser();
    const { professionalId, campaignId } = await params;
    return NextResponse.json(await submitCampaignForApproval(user.id, professionalId, campaignId));
  } catch (error) {
    return errorResponse(error);
  }
}
