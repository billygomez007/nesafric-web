import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";
import { listLedgerEntries } from "@/modules/payments/service";

export async function GET(request: Request) {
  try {
    const propertyId = new URL(request.url).searchParams.get("propertyId") ?? undefined;
    return NextResponse.json(await listLedgerEntries((await requireUser()).id, requireOrganisationId(request), propertyId));
  } catch (error) {
    return errorResponse(error);
  }
}
