import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";
import { getRentCollectionMetrics } from "@/modules/payments/service";

export async function GET(request: Request) {
  try {
    const leaseId = new URL(request.url).searchParams.get("leaseId") ?? undefined;
    return NextResponse.json(await getRentCollectionMetrics((await requireUser()).id, requireOrganisationId(request), leaseId));
  } catch (error) {
    return errorResponse(error);
  }
}
