import { NextResponse } from "next/server";
import { getRentalApplication, updateRentalApplication } from "@/modules/applications/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

type Context = { params: Promise<{ applicationId: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    return NextResponse.json(await getRentalApplication(
      (await requireUser()).id,
      requireOrganisationId(request),
      (await params).applicationId,
    ));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    return NextResponse.json(await updateRentalApplication(
      (await requireUser()).id,
      requireOrganisationId(request),
      (await params).applicationId,
      await request.json(),
    ));
  } catch (error) {
    return errorResponse(error);
  }
}
