import { NextResponse } from "next/server";
import { updateWhatsAppSupportRequest } from "@/modules/whatsapp-assistant/admin";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requirePlatformPrincipal } from "@/platform/platform-admin/auth";

type Context = { params: Promise<{ requestId: string }> };

export async function PATCH(request: Request, { params }: Context) {
  try {
    const principal = await requirePlatformPrincipal(await requireUser());
    const { requestId } = await params;
    return NextResponse.json(await updateWhatsAppSupportRequest(principal, requestId, await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
}
