import { NextResponse } from "next/server";

import { errorResponse } from "@/platform/errors";
import { finaliseVariableChargeObligation } from "@/modules/recurring-charges/service";
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
      await finaliseVariableChargeObligation(
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
