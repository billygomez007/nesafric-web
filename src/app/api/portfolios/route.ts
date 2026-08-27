import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";
import { createPortfolio, listPortfolios } from "@/modules/assets/service";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    return NextResponse.json(await createPortfolio(user.id, requireOrganisationId(request), await request.json()), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    return NextResponse.json(await listPortfolios(user.id, requireOrganisationId(request)));
  } catch (error) {
    return errorResponse(error);
  }
}
