import { NextResponse } from "next/server";
import { markAllNotificationsRead } from "@/modules/notifications/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

export async function PATCH(request: Request) {
  try {
    return NextResponse.json({ updated: await markAllNotificationsRead((await requireUser()).id, requireOrganisationId(request)) });
  } catch (error) {
    return errorResponse(error);
  }
}
