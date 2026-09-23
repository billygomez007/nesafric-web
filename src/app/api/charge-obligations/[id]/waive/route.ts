import { NextResponse } from "next/server";

import { errorResponse } from "@/platform/errors";
import { waiveChargeObligation } from "@/modules/recurring-charges/service";
import { requireRecurringChargeWriteContext } from "@/modules/recurring-charges/api";

type Context = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(request: Request, { params }: Context) {
  try {
    const { userId, organisationId } =
      await requireRecurringChargeWriteContext(request);

    const { id } = await params;

    return NextResponse.json(
      await waiveChargeObligation(
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
