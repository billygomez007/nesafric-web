import { NextResponse } from "next/server";
import { transitionRentalApplication } from "@/modules/applications/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

type Context = { params: Promise<{ applicationId: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    return NextResponse.json(await transitionRentalApplication(
      (await requireUser()).id,
      requireOrganisationId(request),
      (await params).applicationId,
      await request.json(),
    ));
  } catch (error) {
    return errorResponse(error);
  }
}
