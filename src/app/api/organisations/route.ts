import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { createOrganisation } from "@/modules/organisations/service";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const organisation = await createOrganisation(user.id, await request.json());
    return NextResponse.json(organisation, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
