import { NextResponse } from "next/server";
import { listTenantDocuments } from "@/modules/documents/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

/** Tenant-safe document access (item 8): executed lease, receipts, statements, and move-out statement only — never internal/uploaded files. */
export async function GET(request: Request, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    return NextResponse.json(await listTenantDocuments((await requireUser()).id, requireOrganisationId(request), (await params).tenantId));
  } catch (error) {
    return errorResponse(error);
  }
}
