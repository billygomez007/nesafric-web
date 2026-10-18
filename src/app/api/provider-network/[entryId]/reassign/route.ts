import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";
import { z } from "zod";
import { reassignNetworkScope } from "@/modules/provider-network/service";

type Context = { params: Promise<{ entryId: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    const { toEntryId, ...rest } = z.object({ toEntryId: z.string().uuid() }).passthrough().parse(await request.json());
    return NextResponse.json(await reassignNetworkScope((await requireUser()).id, requireOrganisationId(request), (await params).entryId, toEntryId, rest));
  } catch (error) {
    return errorResponse(error);
  }
}
