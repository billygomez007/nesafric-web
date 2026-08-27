import { NextResponse } from "next/server";
import { archiveStorageObject } from "@/modules/documents/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { getOrganisationIdHeader } from "@/platform/organisations/request";

export async function POST(request: Request, { params }: { params: Promise<{ storageObjectId: string }> }) {
  try {
    const organisationId = getOrganisationIdHeader(request);
    const body = await request.text();
    return NextResponse.json(await archiveStorageObject((await requireUser()).id, organisationId, (await params).storageObjectId, body ? JSON.parse(body) : {}));
  } catch (error) {
    return errorResponse(error);
  }
}
