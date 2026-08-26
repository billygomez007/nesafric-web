import { NextResponse } from "next/server";
import { createReminderPolicy, listExpiryPolicies } from "@/modules/reminders/service";
import { requireUser } from "@/platform/auth/session";
import { AppError, errorResponse } from "@/platform/errors";

function organisationId(request: Request) {
  const value = request.headers.get("x-organisation-id");
  if (!value) throw new AppError("ORGANISATION_REQUIRED", 400, "An active organisation is required.");
  return value;
}

export async function GET(request: Request) {
  try {
    return NextResponse.json(await listExpiryPolicies((await requireUser()).id, organisationId(request)));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    return NextResponse.json(await createReminderPolicy((await requireUser()).id, organisationId(request), await request.json()), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
