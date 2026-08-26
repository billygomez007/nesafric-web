import { NextResponse } from "next/server";
import { generateLeaseAgreementPdf } from "@/modules/documents/generation";
import { getSignedStorageAccess } from "@/modules/documents/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

/**
 * Generates the lease agreement PDF (item 3) using real lease/party/property data and (if
 * configured) the organisation's own legal template. While the lease is still DRAFT this also
 * registers a new Phase 11 `LeaseExecutionDocument` version (source GENERATED).
 */
export async function POST(request: Request, { params }: { params: Promise<{ leaseId: string }> }) {
  try {
    const user = await requireUser();
    const organisationId = requireOrganisationId(request);
    const result = await generateLeaseAgreementPdf(user.id, organisationId, (await params).leaseId);
    const access = await getSignedStorageAccess(user.id, organisationId, result.generatedDocument.storageObjectId);
    return NextResponse.json({ ...result, downloadUrl: access.url, downloadUrlExpiresAt: access.expiresAt });
  } catch (error) {
    return errorResponse(error);
  }
}
