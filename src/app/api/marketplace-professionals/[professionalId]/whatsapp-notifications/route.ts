import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { getMarketplaceProfessional } from "@/modules/marketplace-professionals/service";
import {
  getBusinessWhatsAppConfig,
  resolveMarketplaceProfessionalWhatsAppSubject,
  saveBusinessWhatsAppConfig,
} from "@/modules/business-whatsapp/service";

type Context = { params: Promise<{ professionalId: string }> };

async function authorizedSubject(userId: string, professionalId: string) {
  await getMarketplaceProfessional(userId, professionalId);
  return resolveMarketplaceProfessionalWhatsAppSubject(professionalId);
}

export async function GET(_request: Request, { params }: Context) {
  try {
    const { professionalId } = await params;
    const user = await requireUser();
    const subject = await authorizedSubject(user.id, professionalId);

    return NextResponse.json(await getBusinessWhatsAppConfig(subject));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request, { params }: Context) {
  try {
    const { professionalId } = await params;
    const user = await requireUser();
    const subject = await authorizedSubject(user.id, professionalId);

    return NextResponse.json(
      await saveBusinessWhatsAppConfig(subject, await request.json()),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
