import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { requirePlatformPrincipal } from "@/platform/platform-admin/auth";
import { reviewPortfolioVerificationForPlatform } from "@/modules/platform-admin/service";

type Context = { params: Promise<{ verificationId: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    const principal = await requirePlatformPrincipal(await requireUser());
    return NextResponse.json(await reviewPortfolioVerificationForPlatform(principal, (await params).verificationId, await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
}
