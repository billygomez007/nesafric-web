import { NextResponse } from "next/server";
import { reinstateProviderForPlatform } from "@/modules/providers/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";

export async function POST(request: Request, { params }: { params: Promise<{ providerId: string }> }) {
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(
      await reinstateProviderForPlatform(await requireUser(), (await params).providerId, body),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
