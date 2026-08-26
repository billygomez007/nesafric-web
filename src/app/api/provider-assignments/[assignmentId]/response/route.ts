import { NextResponse } from "next/server";
import { respondToProviderAssignment } from "@/modules/providers/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

export async function PATCH(request: Request, { params }: { params: Promise<{ assignmentId: string }> }) {
  try {
    return NextResponse.json(
      await respondToProviderAssignment(
        (await requireUser()).id,
        requireOrganisationId(request),
        (await params).assignmentId,
        await request.json(),
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
