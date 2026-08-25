import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { AppError, errorResponse } from "@/platform/errors";
import { createPortfolio } from "@/modules/assets/service";

export async function POST(request: Request) {
  try {
    const organisationId = request.headers.get("x-organisation-id");
    if (!organisationId) throw new AppError("ORGANISATION_REQUIRED", 400, "An active organisation is required.");
    const user = await requireUser();
    return NextResponse.json(await createPortfolio(user.id, organisationId, await request.json()), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
