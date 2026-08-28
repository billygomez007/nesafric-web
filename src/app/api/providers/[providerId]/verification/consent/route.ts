import { NextResponse } from "next/server";
import { submitProviderVerificationConsent } from "@/modules/providers/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";

/** Provider-owner-scoped consent record — persisted once per verification submission, never
 * pre-checked (the schema rejects anything but an explicit `true` for every field). */
export async function POST(request: Request, { params }: { params: Promise<{ providerId: string }> }) {
  try {
    return NextResponse.json(
      await submitProviderVerificationConsent((await requireUser()).id, (await params).providerId, await request.json()),
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
