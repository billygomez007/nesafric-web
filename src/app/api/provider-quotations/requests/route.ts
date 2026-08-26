import { NextResponse } from "next/server";
import { createProviderQuotationRequest, listProviderQuotationRequests } from "@/modules/providers/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

export async function GET(request: Request) {
  try {
    const query = Object.fromEntries(new URL(request.url).searchParams);
    return NextResponse.json(
      await listProviderQuotationRequests((await requireUser()).id, requireOrganisationId(request), query),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    return NextResponse.json(
      await createProviderQuotationRequest(
        (await requireUser()).id,
        requireOrganisationId(request),
        await request.json(),
      ),
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
