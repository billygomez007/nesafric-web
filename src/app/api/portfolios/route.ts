import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { AppError, errorResponse } from "@/platform/errors";
import { createPortfolio, listPortfolios } from "@/modules/assets/service";

function organisationId(request: Request) {
  const value = request.headers.get("x-organisation-id");
  if (!value) throw new AppError("ORGANISATION_REQUIRED", 400, "An active organisation is required.");
  return value;
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    return NextResponse.json(await createPortfolio(user.id, organisationId(request), await request.json()), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    return NextResponse.json(await listPortfolios(user.id, organisationId(request)));
  } catch (error) {
    return errorResponse(error);
  }
}
