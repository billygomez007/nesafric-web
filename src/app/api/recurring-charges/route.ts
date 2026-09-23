import { NextResponse } from "next/server";

import { errorResponse } from "@/platform/errors";
import {
  createRecurringChargeDefinition,
  listRecurringChargeDefinitions,
} from "@/modules/recurring-charges/service";
import {
  requireRecurringChargeReadContext,
  requireRecurringChargeWriteContext,
} from "@/modules/recurring-charges/api";

export async function GET(request: Request) {
  try {
    const { organisationId } = await requireRecurringChargeReadContext(request);

    const url = new URL(request.url);

    const definitions = await listRecurringChargeDefinitions(organisationId, {
      leaseId: url.searchParams.get("leaseId") ?? undefined,
      propertyId: url.searchParams.get("propertyId") ?? undefined,
      unitId: url.searchParams.has("unitId")
        ? url.searchParams.get("unitId")
        : undefined,
      includeArchived: url.searchParams.get("includeArchived") === "true",
    });

    return NextResponse.json(definitions);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { userId, organisationId } =
      await requireRecurringChargeWriteContext(request);

    const definition = await createRecurringChargeDefinition(
      organisationId,
      userId,
      await request.json(),
    );

    return NextResponse.json(definition, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
