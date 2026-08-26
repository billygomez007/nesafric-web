import { NextResponse } from "next/server";
import { listMarketplaceProfileHistory } from "@/modules/marketplace/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";

type Context = { params: Promise<{ providerId: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    return NextResponse.json(
      await listMarketplaceProfileHistory((await requireUser()).id, (await params).providerId),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
