import { NextResponse } from "next/server";
import { requestWebChatViewing } from "@/modules/conversations/service";
import { errorResponse } from "@/platform/errors";

type Context = { params: Promise<{ conversationId: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    return NextResponse.json(await requestWebChatViewing((await params).conversationId, await request.json()), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
