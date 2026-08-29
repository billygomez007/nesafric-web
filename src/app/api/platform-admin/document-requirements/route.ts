import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { listDocumentRequirementsForPlatform, createDocumentRequirementForPlatform } from "@/modules/providers/service";

export async function GET() {
  try {
    return NextResponse.json(await listDocumentRequirementsForPlatform(await requireUser()));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    return NextResponse.json(await createDocumentRequirementForPlatform(await requireUser(), await request.json()), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
