import { NextResponse } from "next/server";
import { submitProviderQuotation } from "@/modules/providers/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

export async function POST(request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  try {
    return NextResponse.json(
      await submitProviderQuotation(
        (await requireUser()).id,
        requireOrganisationId(request),
        (await params).requestId,
        await request.json(),
      ),
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
