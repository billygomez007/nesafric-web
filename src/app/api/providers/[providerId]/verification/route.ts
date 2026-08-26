import { NextResponse } from "next/server";
import { submitProviderVerification } from "@/modules/providers/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";

export async function POST(request: Request, { params }: { params: Promise<{ providerId: string }> }) {
  try {
    return NextResponse.json(
      await submitProviderVerification((await requireUser()).id, (await params).providerId, await request.json()),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
