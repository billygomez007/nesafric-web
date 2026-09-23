import { NextResponse } from "next/server";

import { errorResponse } from "@/platform/errors";
import { listChargeObligations } from "@/modules/recurring-charges/service";
import { requireRecurringChargeReadContext } from "@/modules/recurring-charges/api";

export async function GET(request: Request) {
  try {
    const { organisationId } = await requireRecurringChargeReadContext(request);

    const url = new URL(request.url);

    return NextResponse.json(
      await listChargeObligations(organisationId, {
        leaseId: url.searchParams.get("leaseId") ?? undefined,
        propertyId: url.searchParams.get("propertyId") ?? undefined,
        tenantOrganisationId:
          url.searchParams.get("tenantOrganisationId") ?? undefined,
        definitionId: url.searchParams.get("definitionId") ?? undefined,
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
