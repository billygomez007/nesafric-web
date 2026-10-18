import { NextResponse } from "next/server";
import { officialWhatsAppOrganisationId } from "@/modules/whatsapp-assistant/identity";
import { receiveWhatsAppWebhook, verifyWhatsAppWebhook } from "@/modules/whatsapp-assistant/webhook";

/**
 * The official NesAfric WhatsApp number. Its channel settings (receiving number, verify token)
 * live on the organisation named by WHATSAPP_OFFICIAL_ORGANISATION_ID.
 */
export async function GET(request: Request) {
  const organisationId = officialWhatsAppOrganisationId();
  if (!organisationId) return new NextResponse("Forbidden", { status: 403 });
  return verifyWhatsAppWebhook(request, organisationId);
}

export async function POST(request: Request) {
  const organisationId = officialWhatsAppOrganisationId();
  if (!organisationId) return new NextResponse("WhatsApp webhook is not configured", { status: 503 });
  return receiveWhatsAppWebhook(request, organisationId);
}
