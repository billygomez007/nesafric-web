import { NextResponse } from "next/server";
import { upsertChannelConfig } from "@/modules/conversations/service";
import type { ConversationChannel } from "@/platform/database/generated/client";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";

type Context = { params: Promise<{ organisationId: string; channel: string }> };

export async function PUT(request: Request, { params }: Context) {
  try {
    const { organisationId, channel } = await params;
    return NextResponse.json(await upsertChannelConfig((await requireUser()).id, organisationId, channel as ConversationChannel, await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
}
