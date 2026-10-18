import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";
import { updateNetworkProvider } from "@/modules/provider-network/service";

type Context = { params: Promise<{ entryId: string }> };

export async function PATCH(request: Request, { params }: Context) {
  try {
    return NextResponse.json(await updateNetworkProvider((await requireUser()).id, requireOrganisationId(request), (await params).entryId, await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
}
