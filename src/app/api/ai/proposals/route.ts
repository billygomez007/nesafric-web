import { NextResponse } from "next/server";
import { createAIProposal, listAIProposals } from "@/modules/ai/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

export async function GET(request: Request) {
  try {
    return NextResponse.json(
      await listAIProposals((await requireUser()).id, requireOrganisationId(request)),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    return NextResponse.json(
      await createAIProposal(
        (await requireUser()).id,
        requireOrganisationId(request),
        await request.json(),
      ),
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
