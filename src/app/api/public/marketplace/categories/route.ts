import { NextResponse } from "next/server";
import { listServiceCategories } from "@/modules/providers/service";
import { errorResponse } from "@/platform/errors";

export async function GET() {
  try {
    return NextResponse.json(await listServiceCategories());
  } catch (error) {
    return errorResponse(error);
  }
}
