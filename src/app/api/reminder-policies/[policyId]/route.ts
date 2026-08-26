import { NextResponse } from "next/server";
import { updateReminderPolicy } from "@/modules/reminders/service";
import { requireUser } from "@/platform/auth/session";
import { AppError, errorResponse } from "@/platform/errors";

function organisationId(request: Request) {
  const value = request.headers.get("x-organisation-id");
  if (!value) throw new AppError("ORGANISATION_REQUIRED", 400, "An active organisation is required.");
  return value;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ policyId: string }> }) {
  try {
    return NextResponse.json(await updateReminderPolicy(
      (await requireUser()).id,
      organisationId(request),
      (await params).policyId,
      await request.json(),
    ));
  } catch (error) {
    return errorResponse(error);
  }
}
