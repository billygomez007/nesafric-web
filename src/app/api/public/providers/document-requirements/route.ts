import { NextResponse } from "next/server";
import { getProviderDocumentRequirements } from "@/modules/providers/service";
import { errorResponse } from "@/platform/errors";

/** Public, unauthenticated — lets the onboarding wizard show which documents are mandatory for a
 * given country/category/provider-type combination before the provider starts uploading. */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const categoryIds = url.searchParams.getAll("categoryId");
    const query = { ...Object.fromEntries(url.searchParams), categoryIds };
    return NextResponse.json(await getProviderDocumentRequirements(query));
  } catch (error) {
    return errorResponse(error);
  }
}
