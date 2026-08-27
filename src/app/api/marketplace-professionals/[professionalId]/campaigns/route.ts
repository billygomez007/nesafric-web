import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { createCampaign, listMarketplaceProfessionalCampaigns } from "@/modules/campaigns/service";

type Context = { params: Promise<{ professionalId: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const user = await requireUser();
    return NextResponse.json(await listMarketplaceProfessionalCampaigns(user.id, (await params).professionalId));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const user = await requireUser();
    const campaign = await createCampaign(user.id, (await params).professionalId, await request.json());
    return NextResponse.json(campaign, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
