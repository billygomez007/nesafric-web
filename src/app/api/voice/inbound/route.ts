import { NextResponse } from "next/server";
import { errorResponse } from "@/platform/errors";
import { startInboundCall } from "@/modules/voice/service";

/**
 * Simulates the moment a telephony provider connects an inbound call (item 1/3). No NesAfric user
 * session is expected here — the caller is a member of the public dialling a phone number, exactly
 * like an unauthenticated web-chat visitor. A real provider integration would additionally verify
 * this request came from the configured telephony vendor (the same signature check
 * `ingestProviderWebhook` already performs for in-call events).
 */
export async function POST(request: Request) {
  try {
    return NextResponse.json(await startInboundCall(await request.json()), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
