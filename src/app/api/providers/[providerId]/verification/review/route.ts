import { NextResponse } from "next/server";
import { reviewProviderVerification } from "@/modules/providers/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

export async function PATCH(request: Request, { params }: { params: Promise<{ providerId: string }> }) {
  try {
    return NextResponse.json(
      await reviewProviderVerification(
        (await requireUser()).id,
        requireOrganisationId(request),
        (await params).providerId,
        await request.json(),
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
