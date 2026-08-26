import { NextResponse } from "next/server";
import { postWebChatMessage } from "@/modules/conversations/service";
import { errorResponse } from "@/platform/errors";
import { getOptionalUser } from "@/platform/auth/session";

type Context = { params: Promise<{ conversationId: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    const user = await getOptionalUser().catch(() => null);
    return NextResponse.json(await postWebChatMessage((await params).conversationId, await request.json(), { userId: user?.id }), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
