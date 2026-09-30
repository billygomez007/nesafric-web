import { NextResponse } from "next/server";

import { resolveMarketplaceProfessionalWhatsAppSubject } from "@/modules/business-whatsapp/service";
import { verifyBusinessWhatsApp } from "@/modules/business-whatsapp/verification";
import { getMarketplaceProfessional } from "@/modules/marketplace-professionals/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";

type Context = {
  params: Promise<{ professionalId: string }>;
};

export const maxDuration = 30;

export async function POST(request: Request, { params }: Context) {
  try {
    const { professionalId } = await params;
    const user = await requireUser();

    await getMarketplaceProfessional(user.id, professionalId);

    const subject =
      await resolveMarketplaceProfessionalWhatsAppSubject(
        professionalId,
      );

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
