import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { cancelOrganisationSubscription } from "@/modules/subscriptions/service";

type Context = { params: Promise<{ organisationId: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    const { organisationId } = await params;
    const body = await request.text();
    const input = body ? JSON.parse(body) : {};
    return NextResponse.json(await cancelOrganisationSubscription((await requireUser()).id, organisationId, input));
  } catch (error) {
    return errorResponse(error);
  }
}
