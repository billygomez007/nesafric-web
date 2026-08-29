import { NextResponse } from "next/server";
import { listPubliclyVisibleServiceCategories } from "@/modules/providers/service";
import { errorResponse } from "@/platform/errors";

export async function GET() {
  try {
    return NextResponse.json(await listPubliclyVisibleServiceCategories());
  } catch (error) {
    return errorResponse(error);
  }
}
