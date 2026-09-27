import { NextResponse } from "next/server";
import { listUserTenancies } from "@/modules/tenants/self-service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";

/** The signed-in user's own tenancies (homes they rent through a NesAfric organisation). */
export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ tenancies: await listUserTenancies(user.id) });
  } catch (error) {
    return errorResponse(error);
  }
}
