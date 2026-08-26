import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";
import { getPaymentIntent } from "@/modules/payments/service";

type Context = { params: Promise<{ intentId: string }> };

/** Polling endpoint for checkout status. Never infer success client-side from a redirect — poll this until the intent's status is a terminal SUCCEEDED/FAILED/CANCELLED set by verified webhook reconciliation. */
export async function GET(request: Request, { params }: Context) {
  try {
    return NextResponse.json(await getPaymentIntent((await requireUser()).id, requireOrganisationId(request), (await params).intentId));
  } catch (error) {
    return errorResponse(error);
  }
}
