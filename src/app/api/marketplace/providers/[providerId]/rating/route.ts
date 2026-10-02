import { NextResponse } from "next/server";

import { rateMarketplaceProvider } from "@/modules/marketplace/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";

type Context = {
  params: Promise<{ providerId: string }>;
};

export async function POST(request: Request, { params }: Context) {
  try {
    const user = await requireUser();
    const { providerId } = await params;
    const input = await request.json();

    return NextResponse.json(
      await rateMarketplaceProvider(user.id, providerId, input),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
