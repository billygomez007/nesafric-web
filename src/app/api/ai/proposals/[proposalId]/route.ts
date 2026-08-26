import { NextResponse } from "next/server";
import { decideAIProposal } from "@/modules/ai/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

type Context = { params: Promise<{ proposalId: string }> };

export async function PATCH(request: Request, { params }: Context) {
  try {
    return NextResponse.json(
      await decideAIProposal(
        (await requireUser()).id,
        requireOrganisationId(request),
        (await params).proposalId,
        await request.json(),
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
