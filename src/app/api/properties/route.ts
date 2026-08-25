import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { AppError, errorResponse } from "@/platform/errors";
import { createProperty, getProperty, updateProperty } from "@/modules/assets/service";

function organisationId(request: Request) {
  const value = request.headers.get("x-organisation-id");
  if (!value) throw new AppError("ORGANISATION_REQUIRED", 400, "An active organisation is required.");
  return value;
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    return NextResponse.json(await createProperty(user.id, organisationId(request), await request.json()), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const propertyId = new URL(request.url).searchParams.get("id");
    if (!propertyId) throw new AppError("PROPERTY_REQUIRED", 400, "A property ID is required.");
    return NextResponse.json(await getProperty(user.id, organisationId(request), propertyId));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireUser();
    const propertyId = new URL(request.url).searchParams.get("id");
    if (!propertyId) throw new AppError("PROPERTY_REQUIRED", 400, "A property ID is required.");
    return NextResponse.json(await updateProperty(user.id, organisationId(request), propertyId, await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
}
