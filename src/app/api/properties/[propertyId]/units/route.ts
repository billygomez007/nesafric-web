import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";
import { createUnit } from "@/modules/assets/service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ propertyId: string }> },
) {
  try {
    const user = await requireUser();
    const { propertyId } = await params;
    return NextResponse.json(
      await createUnit(
        user.id,
        requireOrganisationId(request),
        propertyId,
        await request.json(),
      ),
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
