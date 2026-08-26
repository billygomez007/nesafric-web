import { NextResponse } from "next/server";
import { approveProviderQuotation } from "@/modules/providers/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

export async function POST(request: Request, { params }: { params: Promise<{ quotationId: string }> }) {
  try {
    return NextResponse.json(
      await approveProviderQuotation(
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
