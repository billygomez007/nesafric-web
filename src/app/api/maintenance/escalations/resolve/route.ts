import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requireOrganisationId } from "@/platform/organisations/request";
import { z } from "zod";
import { resolveEscalations } from "@/modules/maintenance-routing/oversight";

const schema = z.object({ escalationId: z.string().uuid().optional(), requestId: z.string().uuid().optional(), note: z.string().trim().max(1000).optional() }).strict();

export async function POST(request: Request) {
  try {
    return NextResponse.json(await resolveEscalations((await requireUser()).id, requireOrganisationId(request), schema.parse(await request.json())));
  } catch (error) {
    return errorResponse(error);
  }
}
