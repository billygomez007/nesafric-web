import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { getProvider } from "@/modules/providers/service";
import {
  getBusinessWhatsAppConfig,
  resolveServiceProviderWhatsAppSubject,
  saveBusinessWhatsAppConfig,
} from "@/modules/business-whatsapp/service";

type Context = { params: Promise<{ providerId: string }> };

async function authorizedSubject(userId: string, providerId: string) {
  await getProvider(userId, null, providerId);
  return resolveServiceProviderWhatsAppSubject(providerId);
}

export async function GET(_request: Request, { params }: Context) {
  try {
    const { providerId } = await params;
    const user = await requireUser();
    const subject = await authorizedSubject(user.id, providerId);

    return NextResponse.json(await getBusinessWhatsAppConfig(subject));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request, { params }: Context) {
  try {
    const { providerId } = await params;
    const user = await requireUser();
    const subject = await authorizedSubject(user.id, providerId);

    return NextResponse.json(
      await saveBusinessWhatsAppConfig(subject, await request.json()),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
