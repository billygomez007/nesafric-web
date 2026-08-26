import { NextResponse } from "next/server";
import { generateMoveOutStatementPdf } from "@/modules/documents/generation";
import { getSignedStorageAccess } from "@/modules/documents/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

/** Generates the final move-out settlement statement PDF (item 3) from the real deposit settlement record. */
export async function POST(request: Request, { params }: { params: Promise<{ leaseId: string }> }) {
  try {
    const user = await requireUser();
    const organisationId = requireOrganisationId(request);
    const generated = await generateMoveOutStatementPdf(user.id, organisationId, (await params).leaseId);
    const access = await getSignedStorageAccess(user.id, organisationId, generated.storageObjectId);
    return NextResponse.json({ ...generated, downloadUrl: access.url, downloadUrlExpiresAt: access.expiresAt });
  } catch (error) {
    return errorResponse(error);
  }
}
