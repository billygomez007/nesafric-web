import { NextResponse } from "next/server";
import { saveProvider, unsaveProvider } from "@/modules/marketplace/saved-providers";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";

type Context = { params: Promise<{ providerId: string }> };

/** Save a publicly listed provider for the signed-in user (idempotent). */
export async function POST(_request: Request, { params }: Context) {
  try {
    const user = await requireUser();
    return NextResponse.json(await saveProvider(user.id, (await params).providerId));
  } catch (error) {
    return errorResponse(error);
  }
}

/** Remove a saved provider for the signed-in user (idempotent). */
export async function DELETE(_request: Request, { params }: Context) {
  try {
    const user = await requireUser();
    return NextResponse.json(await unsaveProvider(user.id, (await params).providerId));
  } catch (error) {
    return errorResponse(error);
  }
}
