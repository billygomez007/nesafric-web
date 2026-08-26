import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requirePlatformPrincipal } from "@/platform/platform-admin/auth";
import { getOrganisationDetailForPlatform } from "@/modules/platform-admin/service";

type Context = { params: Promise<{ organisationId: string }> };

/** Full organisation detail (item 8): subscription/plan/entitlements/usage/invoices/support
 * sessions — requires an active support session (item 9), enforced inside the service call. */
export async function GET(_request: Request, { params }: Context) {
  try {
    const principal = await requirePlatformPrincipal(await requireUser());
    const { organisationId } = await params;
    return NextResponse.json(await getOrganisationDetailForPlatform(principal, organisationId));
  } catch (error) {
    return errorResponse(error);
  }
}
