import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse, readJsonBody } from "@/platform/errors";
import { requirePlatformPrincipal } from "@/platform/platform-admin/auth";
import { assignWhatsAppNumberForPlatform, listWhatsAppNumbersForPlatform } from "@/modules/platform-admin/service";

export async function GET() {
  try {
    const principal = await requirePlatformPrincipal(await requireUser());
    return NextResponse.json(await listWhatsAppNumbersForPlatform(principal));
  } catch (error) {
    return errorResponse(error);
  }
}

/** Assigns or moves a WhatsApp phone number ID to an organisation (`whatsapp_numbers.manage`). */
export async function POST(request: Request) {
  try {
    const principal = await requirePlatformPrincipal(await requireUser());
    return NextResponse.json(await assignWhatsAppNumberForPlatform(principal, await readJsonBody(request)));
  } catch (error) {
    return errorResponse(error);
  }
}
