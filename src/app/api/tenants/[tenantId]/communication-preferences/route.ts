import { NextResponse } from "next/server";
import { updateTenantCommunicationPreferences } from "@/modules/tenants/service";
import { requireUser } from "@/platform/auth/session";
import { AppError, errorResponse } from "@/platform/errors";

function organisationId(request: Request) {
  const value = request.headers.get("x-organisation-id");
  if (!value) throw new AppError("ORGANISATION_REQUIRED", 400, "An active organisation is required.");
  return value;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    return NextResponse.json(await updateTenantCommunicationPreferences(
      (await requireUser()).id,
      organisationId(request),
      (await params).tenantId,
      await request.json(),
    ));
  } catch (error) {
    return errorResponse(error);
  }
}
