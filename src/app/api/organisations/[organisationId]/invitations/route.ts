import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { inviteMember } from "@/modules/organisations/service";

export async function POST(request: Request, { params }: { params: Promise<{ organisationId: string }> }) {
  try {
    const user = await requireUser();
    const { organisationId } = await params;
    const result = await inviteMember(user.id, organisationId, await request.json());
    return NextResponse.json({ invitation: result.invitation, invitationToken: process.env.NODE_ENV === "development" ? result.token : undefined }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
