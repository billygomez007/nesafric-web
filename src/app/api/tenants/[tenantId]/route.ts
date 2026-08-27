import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";
import { getTenant, updateTenant } from "@/modules/tenants/service";

export async function GET(request: Request, { params }: { params: Promise<{ tenantId: string }> }) {
  try { return NextResponse.json(await getTenant((await requireUser()).id, requireOrganisationId(request), (await params).tenantId)); } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ tenantId: string }> }) {
  try { return NextResponse.json(await updateTenant((await requireUser()).id, requireOrganisationId(request), (await params).tenantId, await request.json())); } catch (error) { return errorResponse(error); }
}
