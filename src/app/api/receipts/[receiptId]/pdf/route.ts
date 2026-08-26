import { NextResponse } from "next/server";
import { generateReceiptPdf } from "@/modules/documents/generation";
import { getSignedStorageAccess } from "@/modules/documents/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

/** Generates (or returns the already-issued, immutable) receipt PDF (item 3). */
export async function POST(request: Request, { params }: { params: Promise<{ receiptId: string }> }) {
  try {
    const user = await requireUser();
    const organisationId = requireOrganisationId(request);
    const generated = await generateReceiptPdf(user.id, organisationId, (await params).receiptId);
    const access = await getSignedStorageAccess(user.id, organisationId, generated.storageObjectId);
    return NextResponse.json({ ...generated, downloadUrl: access.url, downloadUrlExpiresAt: access.expiresAt });
  } catch (error) {
    return errorResponse(error);
  }
}
