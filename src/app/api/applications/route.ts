import { NextResponse } from "next/server";
import { createRentalApplication, listRentalApplications } from "@/modules/applications/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

export async function GET(request: Request) {
  try {
    return NextResponse.json(await listRentalApplications(
      (await requireUser()).id,
      requireOrganisationId(request),
      Object.fromEntries(new URL(request.url).searchParams),
    ));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    return NextResponse.json(await createRentalApplication(
      (await requireUser()).id,
      requireOrganisationId(request),
      await request.json(),
    ), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
