import { NextResponse } from "next/server";
import { pageOf, viewingListItem } from "@/modules/listings/lead-responses";
import { listViewingRequests } from "@/modules/listings/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

export async function GET(request: Request) {
  try {
    const page = await listViewingRequests((await requireUser()).id, requireOrganisationId(request), Object.fromEntries(new URL(request.url).searchParams));
    return NextResponse.json(pageOf(page, viewingListItem));
  } catch (error) {
    return errorResponse(error);
  }
}
