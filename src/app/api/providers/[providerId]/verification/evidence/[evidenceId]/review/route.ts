import { NextResponse } from "next/server";
import { reviewProviderEvidence } from "@/modules/providers/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";

/** Per-document platform review (approve/reject one piece of submitted evidence). */
export async function POST(request: Request, { params }: { params: Promise<{ providerId: string; evidenceId: string }> }) {
  try {
    return NextResponse.json(
      await reviewProviderEvidence(await requireUser(), (await params).evidenceId, await request.json()),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
