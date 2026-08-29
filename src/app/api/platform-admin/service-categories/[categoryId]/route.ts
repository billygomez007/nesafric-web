import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { updateServiceCategoryForPlatform } from "@/modules/providers/service";

export async function PATCH(request: Request, { params }: { params: Promise<{ categoryId: string }> }) {
  try {
    return NextResponse.json(
      await updateServiceCategoryForPlatform(await requireUser(), (await params).categoryId, await request.json()),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
