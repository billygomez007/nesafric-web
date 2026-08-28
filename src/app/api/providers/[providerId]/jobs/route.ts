import { NextResponse } from "next/server";
import { getProviderJobHistory } from "@/modules/providers/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { getOrganisationIdHeader } from "@/platform/organisations/request";

export async function GET(request: Request, { params }: { params: Promise<{ providerId: string }> }) {
  try {
    return NextResponse.json(
      await getProviderJobHistory(
        (await requireUser()).id,
        getOrganisationIdHeader(request),
        (await params).providerId,
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
