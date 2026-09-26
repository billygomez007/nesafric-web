import { NextResponse } from "next/server";
import { listPublicHomepageCompanies } from "@/modules/platform-admin/homepage-media-service";
import { errorResponse } from "@/platform/errors";

export async function GET() {
  try {
    return NextResponse.json({
      items: await listPublicHomepageCompanies(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
