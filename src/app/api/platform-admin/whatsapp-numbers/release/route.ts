import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse, readJsonBody } from "@/platform/errors";
import { requirePlatformPrincipal } from "@/platform/platform-admin/auth";
import { releaseWhatsAppNumberForPlatform } from "@/modules/platform-admin/service";

/** Releases a WhatsApp number assignment or an old official number's protection (`whatsapp_numbers.manage`). */
export async function POST(request: Request) {
  try {
    const principal = await requirePlatformPrincipal(await requireUser());
    return NextResponse.json(await releaseWhatsAppNumberForPlatform(principal, await readJsonBody(request)));
  } catch (error) {
    return errorResponse(error);
  }
}
