import { NextResponse } from "next/server";

import { resolveServiceProviderWhatsAppSubject } from "@/modules/business-whatsapp/service";
import { verifyBusinessWhatsApp } from "@/modules/business-whatsapp/verification";
import { getProvider } from "@/modules/providers/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";

type Context = { params: Promise<{ providerId: string }> };

export const maxDuration = 30;

export async function POST(request: Request, { params }: Context) {
  try {
    const { providerId } = await params;
    const user = await requireUser();

    await getProvider(user.id, null, providerId);

    const subject =
      await resolveServiceProviderWhatsAppSubject(providerId);

    const result = await verifyBusinessWhatsApp(
      subject,
      await request.json().catch(() => null),
    );

    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
