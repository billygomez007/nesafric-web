import { NextResponse } from "next/server";
import { restoreStorageObject } from "@/modules/documents/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { getOrganisationIdHeader } from "@/platform/organisations/request";

export async function POST(request: Request, { params }: { params: Promise<{ storageObjectId: string }> }) {
  try {
    const organisationId = getOrganisationIdHeader(request);
    return NextResponse.json(await restoreStorageObject((await requireUser()).id, organisationId, (await params).storageObjectId));
  } catch (error) {
    return errorResponse(error);
  }
}
