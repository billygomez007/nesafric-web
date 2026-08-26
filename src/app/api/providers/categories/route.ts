import { NextResponse } from "next/server";
import { createServiceCategory, listServiceCategories } from "@/modules/providers/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

export async function GET() {
  try {
    await requireUser();
    return NextResponse.json(await listServiceCategories());
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    return NextResponse.json(
      await createServiceCategory((await requireUser()).id, requireOrganisationId(request), await request.json()),
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
