import { NextResponse } from "next/server";
import { markNotificationRead } from "@/modules/notifications/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

export async function PATCH(request: Request, { params }: { params: Promise<{ notificationId: string }> }) {
  try {
    return NextResponse.json(await markNotificationRead((await requireUser()).id, requireOrganisationId(request), (await params).notificationId));
  } catch (error) {
    return errorResponse(error);
  }
}
