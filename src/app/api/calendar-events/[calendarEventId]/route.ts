import { NextResponse } from "next/server";
import { cancelCalendarEvent, getCalendarEvent, updateCalendarEvent } from "@/modules/calendar/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

type Context = { params: Promise<{ calendarEventId: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    return NextResponse.json(await getCalendarEvent((await requireUser()).id, requireOrganisationId(request), (await params).calendarEventId));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    return NextResponse.json(await updateCalendarEvent((await requireUser()).id, requireOrganisationId(request), (await params).calendarEventId, await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    return NextResponse.json(await cancelCalendarEvent((await requireUser()).id, requireOrganisationId(request), (await params).calendarEventId));
  } catch (error) {
    return errorResponse(error);
  }
}
