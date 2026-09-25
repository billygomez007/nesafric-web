import { NextResponse } from "next/server";
import { requestWebChatViewing } from "@/modules/conversations/service";
import { assertPublicWriteAllowed, publicWriteErrorResponse } from "@/platform/security/public-write-limit";

type Context = { params: Promise<{ conversationId: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    const viewing = await requestWebChatViewing((await params).conversationId, await request.json(), {
      // Same per-IP / per-lead / per-listing viewing limits as the listing viewing endpoint.
      beforeCreate: ({ listingId, leadId }) => assertPublicWriteAllowed(request.headers, { kind: "viewing", listingId, leadId }),
    });
    return NextResponse.json(viewing, { status: 201 });
  } catch (error) {
    return publicWriteErrorResponse(error);
  }
}
