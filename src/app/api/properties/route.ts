import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { AppError, errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";
import { createProperty, getProperty, listProperties, updateProperty } from "@/modules/assets/service";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    return NextResponse.json(await createProperty(user.id, requireOrganisationId(request), await request.json()), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const propertyId = url.searchParams.get("id");
    if (propertyId) return NextResponse.json(await getProperty(user.id, requireOrganisationId(request), propertyId));
    const filters = {
      status: url.searchParams.get("status") ?? undefined,
      portfolioId: url.searchParams.get("portfolioId") ?? undefined,
      category: url.searchParams.get("category") ?? undefined,
      search: url.searchParams.get("search") ?? undefined,
    };
    return NextResponse.json(await listProperties(user.id, requireOrganisationId(request), filters));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireUser();
    const propertyId = new URL(request.url).searchParams.get("id");
    if (!propertyId) throw new AppError("PROPERTY_REQUIRED", 400, "A property ID is required.");
    return NextResponse.json(await updateProperty(user.id, requireOrganisationId(request), propertyId, await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
}
