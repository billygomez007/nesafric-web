import { NextResponse } from "next/server";
import { updateAccommodationBookingStatus } from "@/modules/bookings/service";
import { requireUser } from "@/platform/auth/session";
import { errorResponse } from "@/platform/errors";

type Context = { params: Promise<{ bookingId: string }> };

/**
 * Confirm, decline or cancel a booking request. Authorised on the server against the booking's own
 * listing (its organisation, or the professional marketing it) — never the caller's headers.
 */
export async function PATCH(request: Request, { params }: Context) {
  try {
    const user = await requireUser();
    const booking = await updateAccommodationBookingStatus(user.id, (await params).bookingId, await request.json().catch(() => null));
    return NextResponse.json(booking, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
