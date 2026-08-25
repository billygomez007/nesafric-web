import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { AppError, errorResponse } from "@/platform/errors";
import { createTenant, listTenants } from "@/modules/tenants/service";

function organisationId(request: Request) {
  const value = request.headers.get("x-organisation-id");
  if (!value) throw new AppError("ORGANISATION_REQUIRED", 400, "An active organisation is required.");
  return value;
}

export async function GET(request: Request) {
  try { return NextResponse.json(await listTenants((await requireUser()).id, organisationId(request))); } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try { return NextResponse.json(await createTenant((await requireUser()).id, organisationId(request), await request.json()), { status: 201 }); } catch (error) { return errorResponse(error); }
}
