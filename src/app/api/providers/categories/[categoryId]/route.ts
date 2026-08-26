import { NextResponse } from "next/server";
import { updateServiceCategory } from "@/modules/providers/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

export async function PATCH(request: Request, { params }: { params: Promise<{ categoryId: string }> }) {
  try {
    return NextResponse.json(
      await updateServiceCategory(
        (await requireUser()).id,
        requireOrganisationId(request),
        (await params).categoryId,
        await request.json(),
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
