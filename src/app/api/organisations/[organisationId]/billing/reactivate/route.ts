import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { reactivateScheduledCancellation } from "@/modules/subscriptions/service";

type Context = { params: Promise<{ organisationId: string }> };

export async function POST(_request: Request, { params }: Context) {
  try {
    const { organisationId } = await params;
    return NextResponse.json(await reactivateScheduledCancellation((await requireUser()).id, organisationId));
  } catch (error) {
    return errorResponse(error);
  }
}
