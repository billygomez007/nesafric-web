import { NextResponse } from "next/server";
import { uploadOrganisationDocument } from "@/modules/documents/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

/** Controlled upload endpoint (item 2) for listing media, maintenance attachments, move-in/out inspection media, and application documents. Provider verification evidence uploads through its own dedicated, ownership-scoped route instead. */
export async function POST(request: Request) {
  try {
    return NextResponse.json(await uploadOrganisationDocument((await requireUser()).id, requireOrganisationId(request), await request.json()), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
