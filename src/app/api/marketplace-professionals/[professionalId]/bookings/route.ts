import { NextRequest, NextResponse } from "next/server";
import { listProfessionalBookings } from "@/modules/bookings/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";

type Context = { params: Promise<{ professionalId: string }> };

/** Hotel and short-stay booking requests for the listings this professional markets. */
export async function GET(request: NextRequest, { params }: Context) {
  try {
    const user = await requireUser();
    const page = await listProfessionalBookings(user.id, (await params).professionalId, Object.fromEntries(request.nextUrl.searchParams));
    return NextResponse.json(page, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
