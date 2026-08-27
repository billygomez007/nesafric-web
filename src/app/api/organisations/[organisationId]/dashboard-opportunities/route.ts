import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { getDashboardOpportunities } from "@/modules/dashboard-insights/service";

type Context = { params: Promise<{ organisationId: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const user = await requireUser();
    const opportunities = await getDashboardOpportunities(user.id, (await params).organisationId);
    return NextResponse.json({ opportunities });
  } catch (error) {
    return errorResponse(error);
  }
}
