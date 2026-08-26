import { NextResponse } from "next/server";
import { uploadProviderEvidenceDocument } from "@/modules/documents/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";

/** Provider-owner-scoped evidence upload (item 2): mirrors `submitProviderVerification`'s own ownership-based authorisation shape, not an organisation header. */
export async function POST(request: Request, { params }: { params: Promise<{ providerId: string }> }) {
  try {
    return NextResponse.json(
      await uploadProviderEvidenceDocument((await requireUser()).id, (await params).providerId, await request.json()),
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
