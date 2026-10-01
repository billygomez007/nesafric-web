import { NextResponse } from "next/server";
import {
  createMarketplaceEnquiry,
  listMarketplaceEnquiries,
} from "@/modules/marketplace/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { getOrganisationIdHeader } from "@/platform/organisations/request";

export async function GET(request: Request) {
  try {
    const query = Object.fromEntries(new URL(request.url).searchParams);

    return NextResponse.json(
      await listMarketplaceEnquiries(
        (await requireUser()).id,
        getOrganisationIdHeader(request),
        query,
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    return NextResponse.json(
      await createMarketplaceEnquiry(
        (await requireUser()).id,
        getOrganisationIdHeader(request),
        await request.json(),
      ),
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
