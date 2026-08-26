import { NextResponse } from "next/server";
import { verifyConversationIdentity } from "@/modules/conversations/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

type Context = { params: Promise<{ conversationId: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    return NextResponse.json(await verifyConversationIdentity((await requireUser()).id, requireOrganisationId(request), (await params).conversationId, await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
}
