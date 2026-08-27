import { NextResponse } from "next/server";
import { errorResponse } from "@/platform/errors";
import { searchMarketplaceDirectory } from "@/modules/marketplace-professionals/service";

/** Public, unauthenticated marketplace-professional directory (item 8). */
export async function GET(request: Request) {
  try {
    const query = Object.fromEntries(new URL(request.url).searchParams);
    return NextResponse.json(await searchMarketplaceDirectory(query));
  } catch (error) {
    return errorResponse(error);
  }
}
