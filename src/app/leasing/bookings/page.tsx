import { AppShell } from "@/components/app-shell";
import { BookingInbox } from "@/components/booking-inbox";

export default function LeasingBookingsPage() {
  return (
    <AppShell description="Stay requests for your hotels and short stays. Confirm or decline each one." eyebrow="LEASING CRM" title="Bookings">
      <BookingInbox source={{ kind: "organisation" }} />
    </AppShell>
  );
}
