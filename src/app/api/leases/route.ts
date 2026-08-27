import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";
import { createLease, listLeases } from "@/modules/leases/service";

export async function GET(request: Request) {
  try { return NextResponse.json(await listLeases((await requireUser()).id, requireOrganisationId(request))); } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try { return NextResponse.json(await createLease((await requireUser()).id, requireOrganisationId(request), await request.json()), { status: 201 }); } catch (error) { return errorResponse(error); }
}
