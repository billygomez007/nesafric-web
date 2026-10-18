import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";
import { inviteNetworkProvider, listNetwork } from "@/modules/provider-network/service";

export async function GET(request: Request) {
  try {
    return NextResponse.json(await listNetwork((await requireUser()).id, requireOrganisationId(request)));
  } catch (error) {
    return errorResponse(error);
  }
}

/** Invite a professional; they join only by accepting on WhatsApp from the invited number. */
export async function POST(request: Request) {
  try {
    return NextResponse.json(await inviteNetworkProvider((await requireUser()).id, requireOrganisationId(request), { source: "WEB", ...(await request.json()) }), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
