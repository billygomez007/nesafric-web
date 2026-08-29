import { NextResponse } from "next/server";
import { suspendProviderForPlatform } from "@/modules/providers/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";

/** Platform-wide provider suspension — distinct from the landlord-scoped `verification/review`
 * route's own SUSPENDED outcome, which only reflects one landlord's trust. Removes the provider
 * from every landlord's dispatch pool and the public marketplace at once. */
export async function POST(request: Request, { params }: { params: Promise<{ providerId: string }> }) {
  try {
    return NextResponse.json(
      await suspendProviderForPlatform(await requireUser(), (await params).providerId, await request.json()),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
