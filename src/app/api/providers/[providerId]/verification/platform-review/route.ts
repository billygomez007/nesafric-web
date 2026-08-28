import { NextResponse } from "next/server";
import { reviewProviderIdentity } from "@/modules/providers/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";

/** Platform-authority identity/business/skill verification (Ghana Card etc.) — distinct from the
 * landlord-scoped `verification/review` route, which requires an organisation header and a
 * directory relationship. This route requires neither: it is the only path by which a
 * self-registered, directory-less provider can ever become VERIFIED. */
export async function POST(request: Request, { params }: { params: Promise<{ providerId: string }> }) {
  try {
    return NextResponse.json(
      await reviewProviderIdentity(await requireUser(), (await params).providerId, await request.json()),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
