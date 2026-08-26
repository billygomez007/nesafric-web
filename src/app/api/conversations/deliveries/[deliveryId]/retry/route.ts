import { NextResponse } from "next/server";
import { retryConversationMessageDelivery } from "@/modules/conversations/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

type Context = { params: Promise<{ deliveryId: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    return NextResponse.json(await retryConversationMessageDelivery((await requireUser()).id, requireOrganisationId(request), (await params).deliveryId));
  } catch (error) {
    return errorResponse(error);
  }
}
