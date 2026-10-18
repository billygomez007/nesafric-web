import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";
import { z } from "zod";
import { archiveRoutingRule, setRoutingRulePaused, updateRoutingRule } from "@/modules/maintenance-routing/rules";

type Context = { params: Promise<{ ruleId: string }> };

/** Body `{ paused: boolean }` pauses or resumes; anything else updates the rule. */
export async function PATCH(request: Request, { params }: Context) {
  try {
    const body = await request.json();
    const userId = (await requireUser()).id;
    const organisationId = requireOrganisationId(request);
    const { ruleId } = await params;
    const pause = z.object({ paused: z.boolean() }).strict().safeParse(body);
    return NextResponse.json(pause.success ? await setRoutingRulePaused(userId, organisationId, ruleId, pause.data.paused) : await updateRoutingRule(userId, organisationId, ruleId, body));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    return NextResponse.json(await archiveRoutingRule((await requireUser()).id, requireOrganisationId(request), (await params).ruleId));
  } catch (error) {
    return errorResponse(error);
  }
}
