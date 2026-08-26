import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { listAvailablePaymentProviders } from "@/modules/payments/service";
// Side-effect import: ensures the Ghana gateway adapters are registered before listing them.
import "@/modules/payments/gateways";

/** Lists registered payment provider adapters and whether each is currently configured, without exposing secrets. Used by checkout UIs to hide/label unavailable providers. */
export async function GET() {
  try {
    await requireUser();
    return NextResponse.json(listAvailablePaymentProviders());
  } catch (error) {
    return errorResponse(error);
  }
}
