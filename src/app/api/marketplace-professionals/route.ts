import { NextResponse } from "next/server";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";
import { createMarketplaceProfessional, listUserMarketplaceProfessionals } from "@/modules/marketplace-professionals/service";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const professional = await createMarketplaceProfessional(user.id, await request.json());
    return NextResponse.json(professional, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json(await listUserMarketplaceProfessionals(user.id));
  } catch (error) {
    return errorResponse(error);
  }
}
