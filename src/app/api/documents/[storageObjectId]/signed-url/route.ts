import { NextResponse } from "next/server";
import { getSignedStorageAccess } from "@/modules/documents/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { getOrganisationIdHeader } from "@/platform/organisations/request";

/** Signed temporary access (item 1): never returns a raw storage key, only a time-limited signed URL (or the public URL for PUBLIC objects). Organisation header is optional — an individually-owned provider's evidence has no organisation context. */
export async function GET(request: Request, { params }: { params: Promise<{ storageObjectId: string }> }) {
  try {
    const organisationId = getOrganisationIdHeader(request);
    return NextResponse.json(await getSignedStorageAccess((await requireUser()).id, organisationId, (await params).storageObjectId));
  } catch (error) {
    return errorResponse(error);
  }
}
