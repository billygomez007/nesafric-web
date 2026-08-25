import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { AppError, errorResponse } from "@/platform/errors";
import { getDashboard } from "@/modules/assets/dashboard";

export async function GET(request: Request) {
  try {
    const organisationId = request.headers.get("x-organisation-id");
    if (!organisationId) throw new AppError("ORGANISATION_REQUIRED", 400, "An active organisation is required.");
    return NextResponse.json(await getDashboard((await requireUser()).id, organisationId));
  } catch (error) {
    return errorResponse(error);
  }
}
