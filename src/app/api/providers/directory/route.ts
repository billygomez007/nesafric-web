import { NextResponse } from "next/server";
import { addProviderToDirectory } from "@/modules/providers/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

export async function POST(request: Request) {
  try {
    return NextResponse.json(
      await addProviderToDirectory((await requireUser()).id, requireOrganisationId(request), await request.json()),
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
