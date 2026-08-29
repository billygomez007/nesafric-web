import { NextResponse } from "next/server";
import { searchServiceProvidersForPlatform } from "@/modules/providers/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams.get("q") ?? "";
    return NextResponse.json(await searchServiceProvidersForPlatform(await requireUser(), query));
  } catch (error) {
    return errorResponse(error);
  }
}
