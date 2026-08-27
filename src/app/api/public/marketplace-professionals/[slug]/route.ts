import { NextResponse } from "next/server";
import { errorResponse } from "@/platform/errors";
import { getPublicMarketplaceProfessionalProfile } from "@/modules/marketplace-professionals/service";

type Context = { params: Promise<{ slug: string }> };

/** Public, unauthenticated — item 10's "premium public profile readiness". */
export async function GET(_request: Request, { params }: Context) {
  try {
    const { slug } = await params;
    return NextResponse.json(await getPublicMarketplaceProfessionalProfile(slug));
  } catch (error) {
    return errorResponse(error);
  }
}
