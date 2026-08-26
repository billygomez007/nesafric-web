import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { getOrganisationBillingSnapshot } from "@/modules/subscriptions/service";

type Context = { params: Promise<{ organisationId: string }> };

/** Organisation billing settings snapshot (item 7): plan, status, cycle, usage/limits, recent
 * invoices, available plans. No platform controls are ever reachable through this route. */
export async function GET(_request: Request, { params }: Context) {
  try {
    const { organisationId } = await params;
    return NextResponse.json(await getOrganisationBillingSnapshot((await requireUser()).id, organisationId));
  } catch (error) {
    return errorResponse(error);
  }
}
