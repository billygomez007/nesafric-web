import { NextResponse } from "next/server";
import { listDocumentTemplates, upsertDocumentTemplate } from "@/modules/documents/templates";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";

type Context = { params: Promise<{ organisationId: string }> };

/** Organisation-configurable document templates (item 3): PropertyOS never ships legal clauses of its own. */
export async function GET(_request: Request, { params }: Context) {
  try {
    return NextResponse.json(await listDocumentTemplates((await requireUser()).id, (await params).organisationId));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request, { params }: Context) {
  try {
    return NextResponse.json(await upsertDocumentTemplate((await requireUser()).id, (await params).organisationId, await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
}
