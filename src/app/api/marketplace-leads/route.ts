import { NextResponse } from "next/server";
import { listMarketplaceLeads } from "@/modules/listings/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

export async function GET(request: Request) {
  try {
    return NextResponse.json(await listMarketplaceLeads(
      (await requireUser()).id,
      requireOrganisationId(request),
      Object.fromEntries(new URL(request.url).searchParams),
    ));
  } catch (error) {
    return errorResponse(error);
  }
}
