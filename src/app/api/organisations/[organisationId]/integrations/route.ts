import { NextResponse } from "next/server";
import { getOrganisationIntegrationOverview } from "@/modules/integrations/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";

type Context = { params: Promise<{ organisationId: string }> };

/** Organisation-scoped integration configuration/health (item 7): type/provider/enabled/status, without secrets. */
export async function GET(_request: Request, { params }: Context) {
  try {
    return NextResponse.json(await getOrganisationIntegrationOverview((await requireUser()).id, (await params).organisationId));
  } catch (error) {
    return errorResponse(error);
  }
}
