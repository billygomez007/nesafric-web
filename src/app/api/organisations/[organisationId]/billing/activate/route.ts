import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { startPropertyManagement } from "@/modules/subscriptions/service";

type Context = { params: Promise<{ organisationId: string }> };

/** "Start free trial": activates property management. Idempotent; never charges. */
export async function POST(_request: Request, { params }: Context) {
  try {
    const { organisationId } = await params;
    const subscription = await startPropertyManagement((await requireUser()).id, organisationId);
    return NextResponse.json({ status: subscription.status, trialEndsAt: subscription.trialEndsAt });
  } catch (error) {
    return errorResponse(error);
  }
}
