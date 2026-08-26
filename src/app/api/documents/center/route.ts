import { NextResponse } from "next/server";
import { listDocumentCenter } from "@/modules/documents/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

/** Secure Document Center (item 8): permission-checked filters across property/unit/tenant/lease/payment/maintenance/application/inspection/type/date; staff-only. */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    return NextResponse.json(await listDocumentCenter((await requireUser()).id, requireOrganisationId(request), Object.fromEntries(url.searchParams)));
  } catch (error) {
    return errorResponse(error);
  }
}
