import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { autoEscalateArtisanDispatch } from "@/modules/voice/service";

type Context = { params: Promise<{ organisationId: string; workOrderId: string }> };

/** Item 7's automatic backup escalation, exposed as an explicit, idempotent, re-callable action —
 * a scheduler/cron or an operator can call this repeatedly; it only actually escalates when the
 * latest dispatch attempt is genuinely `BACKUP_REQUIRED` and the configured retry delay has
 * elapsed, and is bounded per work order. */
export async function POST(_request: Request, { params }: Context) {
  try {
    const user = await requireUser();
    const { organisationId, workOrderId } = await params;
    return NextResponse.json(await autoEscalateArtisanDispatch(user.id, organisationId, workOrderId));
  } catch (error) {
    return errorResponse(error);
  }
}
