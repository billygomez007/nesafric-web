import { NextResponse } from "next/server";
import { previewOrganisationInvitation } from "@/modules/organisations/invitations";
import { errorResponse } from "@/platform/errors";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const token =
      typeof body?.token === "string"
        ? body.token
        : "";

    return NextResponse.json(
      await previewOrganisationInvitation(token),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
