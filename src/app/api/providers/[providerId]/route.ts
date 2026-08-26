import { NextResponse } from "next/server";
import { getProvider, updateServiceProvider } from "@/modules/providers/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

type Context = { params: Promise<{ providerId: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    return NextResponse.json(
      await getProvider((await requireUser()).id, requireOrganisationId(request), (await params).providerId),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    return NextResponse.json(
      await updateServiceProvider((await requireUser()).id, (await params).providerId, await request.json()),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
