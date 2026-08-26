import { NextResponse } from "next/server";
import { markAllNotificationsRead } from "@/modules/notifications/service";
import { requireUser } from "@/platform/auth/session";
import { AppError, errorResponse } from "@/platform/errors";

function organisationId(request: Request) {
  const value = request.headers.get("x-organisation-id");
  if (!value) throw new AppError("ORGANISATION_REQUIRED", 400, "An active organisation is required.");
  return value;
}

export async function PATCH(request: Request) {
  try {
    return NextResponse.json({ updated: await markAllNotificationsRead((await requireUser()).id, organisationId(request)) });
  } catch (error) {
    return errorResponse(error);
  }
}
