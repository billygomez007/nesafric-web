import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";
import { createDepositCheckout } from "@/modules/payments/service";

/**
 * Manager-initiated provider-backed security-deposit checkout. Mirrors `/api/payment-intents`
 * but the resulting intent is created with `purpose: "DEPOSIT"`, so a verified success webhook
 * produces a `SecurityDeposit` (never a `Payment`/rent allocation). The response only reflects
 * the checkout's `PENDING`/`PROCESSING` state — poll `/api/payment-intents/[intentId]` for the
 * terminal, webhook-reconciled status.
 */
export async function POST(request: Request) {
  try {
    return NextResponse.json(await createDepositCheckout((await requireUser()).id, requireOrganisationId(request), await request.json()), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
