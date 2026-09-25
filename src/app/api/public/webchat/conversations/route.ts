import { NextResponse } from "next/server";
import { startWebChatConversation } from "@/modules/conversations/service";
import { getOptionalUser } from "@/platform/auth/session";
import { assertPublicWriteAllowed, publicWriteErrorResponse } from "@/platform/security/public-write-limit";

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
    const conversation = await startWebChatConversation(await request.json(), {
      userId: user?.id,
      // A chat that creates a listing lead shares the guest enquiry limits, so it can't bypass them.
      beforeLeadCreate: ({ listingId, email, phone }) => assertPublicWriteAllowed(request.headers, { kind: "enquiry", listingId, contact: { email, phone } }),
    });
    return NextResponse.json(conversation, {
      status: 201,
      headers: { "X-RateLimit-Policy": `${PUBLIC_WEB_CHAT_RATE_LIMIT.policy};w=${PUBLIC_WEB_CHAT_RATE_LIMIT.windowSeconds};limit=${PUBLIC_WEB_CHAT_RATE_LIMIT.limit}` },
    });
  } catch (error) {
    return publicWriteErrorResponse(error);
  }
}
