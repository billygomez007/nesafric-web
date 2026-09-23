import { NextResponse } from "next/server";

import { AppError, errorResponse } from "@/platform/errors";
import { generateRecurringChargeObligations } from "@/modules/recurring-charges/service";
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

    const raw = await request.json().catch(() => ({}));

    let throughDate: Date | undefined;

    if (
      raw &&
      typeof raw === "object" &&
      "throughDate" in raw &&
      raw.throughDate !== undefined &&
      raw.throughDate !== null &&
      raw.throughDate !== ""
    ) {
      if (typeof raw.throughDate !== "string") {
        throw new AppError(
          "INVALID_THROUGH_DATE",
          400,
          "throughDate must be an ISO date string.",
        );
      }

      const candidate = new Date(raw.throughDate);

      if (Number.isNaN(candidate.getTime())) {
        throw new AppError(
          "INVALID_THROUGH_DATE",
          400,
          "throughDate must be a valid date.",
        );
      }

      throughDate = candidate;
    }

    return NextResponse.json(
      await generateRecurringChargeObligations({
        organisationId,
        actorUserId: userId,
        definitionId: id,
        throughDate,
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
