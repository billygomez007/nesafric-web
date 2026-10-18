import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse, readJsonBody } from "@/platform/errors";
import { requirePlatformPrincipal } from "@/platform/platform-admin/auth";
import { dismissWhatsAppClaimForPlatform } from "@/modules/platform-admin/service";

/** Dismisses an organisation's unreviewed WhatsApp number claim (`whatsapp_numbers.manage`). */
export async function POST(request: Request) {
  try {
    const principal = await requirePlatformPrincipal(await requireUser());
    return NextResponse.json(await dismissWhatsAppClaimForPlatform(principal, await readJsonBody(request)));
  } catch (error) {
    return errorResponse(error);
  }
}
