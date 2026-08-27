import { NextResponse } from "next/server";
import { updateReminderPolicy } from "@/modules/reminders/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

export async function PATCH(request: Request, { params }: { params: Promise<{ policyId: string }> }) {
  try {
    return NextResponse.json(await updateReminderPolicy(
      (await requireUser()).id,
      requireOrganisationId(request),
      (await params).policyId,
      await request.json(),
    ));
  } catch (error) {
    return errorResponse(error);
  }
}
