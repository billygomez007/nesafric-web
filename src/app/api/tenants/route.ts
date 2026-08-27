import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";
import { createTenant, listTenants } from "@/modules/tenants/service";

export async function GET(request: Request) {
  try { return NextResponse.json(await listTenants((await requireUser()).id, requireOrganisationId(request))); } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try { return NextResponse.json(await createTenant((await requireUser()).id, requireOrganisationId(request), await request.json()), { status: 201 }); } catch (error) { return errorResponse(error); }
}
