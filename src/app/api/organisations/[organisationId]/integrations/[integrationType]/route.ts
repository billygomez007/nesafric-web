import { NextResponse } from "next/server";
import { upsertIntegrationConfig } from "@/modules/integrations/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";

type Context = { params: Promise<{ organisationId: string; integrationType: string }> };

export async function PUT(request: Request, { params }: Context) {
  try {
    const { organisationId, integrationType } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    return NextResponse.json(await upsertIntegrationConfig((await requireUser()).id, organisationId, { ...body, integrationType }));
  } catch (error) {
    return errorResponse(error);
  }
}
