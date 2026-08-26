import { NextResponse } from "next/server";
import { getApplicant, updateApplicant } from "@/modules/applications/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

type Context = { params: Promise<{ applicantId: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    return NextResponse.json(await getApplicant(
      (await requireUser()).id,
      requireOrganisationId(request),
      (await params).applicantId,
    ));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    return NextResponse.json(await updateApplicant(
      (await requireUser()).id,
      requireOrganisationId(request),
      (await params).applicantId,
      await request.json(),
    ));
  } catch (error) {
    return errorResponse(error);
  }
}
