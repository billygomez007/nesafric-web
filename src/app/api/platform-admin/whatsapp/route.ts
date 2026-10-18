import { NextResponse } from "next/server";
import { getWhatsAppAssistantOverview } from "@/modules/whatsapp-assistant/admin";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requirePlatformPrincipal } from "@/platform/platform-admin/auth";

export async function GET(request: Request) {
  try {
    const principal = await requirePlatformPrincipal(await requireUser());
    const url = new URL(request.url);
    return NextResponse.json(await getWhatsAppAssistantOverview(principal, {
      ...(url.searchParams.get("days") ? { days: url.searchParams.get("days") } : {}),
      ...(url.searchParams.get("supportStatus") ? { supportStatus: url.searchParams.get("supportStatus") } : {}),
    }));
  } catch (error) {
    return errorResponse(error);
  }
}
