import { NextResponse } from "next/server";
import { startWebChatConversation } from "@/modules/conversations/service";
import { errorResponse } from "@/platform/errors";
import { getOptionalUser } from "@/platform/auth/session";

const PUBLIC_WEB_CHAT_RATE_LIMIT = {
  policy: "public-web-chat",
  limit: 30,
  windowSeconds: 60,
  keyStrategy: "ip+route",
  enforcement: "gateway-ready",
} as const;

export async function POST(request: Request) {
  try {
    const user = await getOptionalUser().catch(() => null);
    const conversation = await startWebChatConversation(await request.json(), { userId: user?.id });
    return NextResponse.json(conversation, {
      status: 201,
      headers: { "X-RateLimit-Policy": `${PUBLIC_WEB_CHAT_RATE_LIMIT.policy};w=${PUBLIC_WEB_CHAT_RATE_LIMIT.windowSeconds};limit=${PUBLIC_WEB_CHAT_RATE_LIMIT.limit}` },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
