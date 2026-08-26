import { NextResponse } from "next/server";
import { createServiceProvider, listProviders } from "@/modules/providers/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const query = Object.fromEntries(new URL(request.url).searchParams);
    return NextResponse.json(await listProviders(user.id, requireOrganisationId(request), query));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    return NextResponse.json(await createServiceProvider((await requireUser()).id, await request.json()), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
