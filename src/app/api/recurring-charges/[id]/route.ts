import { NextResponse } from "next/server";

import { errorResponse } from "@/platform/errors";
import {
  archiveRecurringChargeDefinition,
  getRecurringChargeDefinition,
  updateRecurringChargeDefinition,
} from "@/modules/recurring-charges/service";
import {
  requireRecurringChargeReadContext,
  requireRecurringChargeWriteContext,
} from "@/modules/recurring-charges/api";

type Context = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(request: Request, { params }: Context) {
  try {
    const { organisationId } = await requireRecurringChargeReadContext(request);

    const { id } = await params;

    return NextResponse.json(
      await getRecurringChargeDefinition(organisationId, id),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const { userId, organisationId } =
      await requireRecurringChargeWriteContext(request);

    const { id } = await params;

    return NextResponse.json(
      await updateRecurringChargeDefinition(
        organisationId,
        userId,
        id,
        await request.json(),
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    const { userId, organisationId } =
      await requireRecurringChargeWriteContext(request);

    const { id } = await params;

    return NextResponse.json(
      await archiveRecurringChargeDefinition(organisationId, userId, id),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
