import { NextResponse } from "next/server";
import { rejectProviderQuotation } from "@/modules/providers/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

export async function POST(request: Request, { params }: { params: Promise<{ quotationId: string }> }) {
  try {
    return NextResponse.json(
      await rejectProviderQuotation(
        (await requireUser()).id,
        requireOrganisationId(request),
        (await params).quotationId,
        await request.json(),
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
