import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";
import { listPayments } from "@/modules/payments/service";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    return NextResponse.json(await listPayments((await requireUser()).id, requireOrganisationId(request), Object.fromEntries(url.searchParams)));
  } catch (error) {
    return errorResponse(error);
  }
}
