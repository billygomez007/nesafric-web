import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { acceptOrganisationInvitation } from "@/modules/organisations/invitations";
import { errorResponse } from "@/platform/errors";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json();

    return NextResponse.json(
      await acceptOrganisationInvitation(
        user.id,
        typeof body?.token === "string" ? body.token : "",
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
