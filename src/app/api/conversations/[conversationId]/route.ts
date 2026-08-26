import { NextResponse } from "next/server";
import { getConversationDetail } from "@/modules/conversations/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

type Context = { params: Promise<{ conversationId: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    return NextResponse.json(await getConversationDetail((await requireUser()).id, requireOrganisationId(request), (await params).conversationId));
  } catch (error) {
    return errorResponse(error);
  }
}
