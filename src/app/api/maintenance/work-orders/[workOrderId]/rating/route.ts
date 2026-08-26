import { NextResponse } from "next/server";
import { rateProvider } from "@/modules/providers/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

export async function POST(request: Request, { params }: { params: Promise<{ workOrderId: string }> }) {
  try {
    return NextResponse.json(
      await rateProvider(
        (await requireUser()).id,
        requireOrganisationId(request),
        (await params).workOrderId,
        await request.json(),
      ),
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
