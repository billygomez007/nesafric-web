import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { getMarketplaceDashboardMetrics } from "@/modules/marketplace-professionals/service";

type Context = { params: Promise<{ professionalId: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const user = await requireUser();
    return NextResponse.json(await getMarketplaceDashboardMetrics(user.id, (await params).professionalId));
  } catch (error) {
    return errorResponse(error);
  }
}
