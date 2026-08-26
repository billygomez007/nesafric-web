import { NextResponse } from "next/server";
import { createCalendarEvent, listCalendarEvents } from "@/modules/calendar/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

/** Standalone calendar CRUD (item 6): viewings, move-ins/out, inspections, and maintenance appointments not already auto-linked from their owning domain. */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    return NextResponse.json(await listCalendarEvents((await requireUser()).id, requireOrganisationId(request), Object.fromEntries(url.searchParams)));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    return NextResponse.json(await createCalendarEvent((await requireUser()).id, requireOrganisationId(request), await request.json()), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
