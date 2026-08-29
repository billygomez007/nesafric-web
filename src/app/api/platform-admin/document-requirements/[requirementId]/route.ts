import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { updateDocumentRequirementForPlatform } from "@/modules/providers/service";

export async function PATCH(request: Request, { params }: { params: Promise<{ requirementId: string }> }) {
  try {
    return NextResponse.json(
      await updateDocumentRequirementForPlatform(await requireUser(), (await params).requirementId, await request.json()),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
