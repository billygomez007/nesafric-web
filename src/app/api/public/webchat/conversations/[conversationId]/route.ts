import { NextResponse } from "next/server";
import { getWebChatConversation } from "@/modules/conversations/service";
import { AppError, errorResponse } from "@/platform/errors";

type Context = { params: Promise<{ conversationId: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const chatToken = new URL(request.url).searchParams.get("chatToken");
    if (!chatToken) throw new AppError("CHAT_TOKEN_REQUIRED", 400, "A chat token is required.");
    return NextResponse.json(await getWebChatConversation((await params).conversationId, chatToken));
  } catch (error) {
    return errorResponse(error);
  }
}
