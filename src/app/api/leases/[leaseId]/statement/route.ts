import { NextResponse } from "next/server";
import { generateTenantStatementPdf } from "@/modules/documents/generation";
import { getSignedStorageAccess } from "@/modules/documents/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

/** Generates the tenant's current rent statement PDF (item 3), optionally as of a given date. */
export async function POST(request: Request, { params }: { params: Promise<{ leaseId: string }> }) {
  try {
    const user = await requireUser();
    const organisationId = requireOrganisationId(request);
    const body = await request.text();
    const input = body ? (JSON.parse(body) as { asOfDate?: string }) : {};
    const generated = await generateTenantStatementPdf(user.id, organisationId, (await params).leaseId, {
      asOfDate: input.asOfDate ? new Date(input.asOfDate) : undefined,
    });
    const access = await getSignedStorageAccess(user.id, organisationId, generated.storageObjectId);
    return NextResponse.json({ ...generated, downloadUrl: access.url, downloadUrlExpiresAt: access.expiresAt });
  } catch (error) {
    return errorResponse(error);
  }
}
