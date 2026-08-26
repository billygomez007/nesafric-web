import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";
import { listReconciliationEvents } from "@/modules/payments/service";

/** Manager financial view: matched/mismatched/unmatched/duplicate provider webhook events. */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    return NextResponse.json(await listReconciliationEvents((await requireUser()).id, requireOrganisationId(request), Object.fromEntries(url.searchParams)));
  } catch (error) {
    return errorResponse(error);
  }
}
