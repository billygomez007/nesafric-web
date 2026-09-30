import { BookingInbox } from "@/components/booking-inbox";
import { MarketplaceProShell } from "@/components/marketplace-pro-shell";

export default async function MarketplaceBookingsPage({ params }: { params: Promise<{ professionalId: string }> }) {
  const { professionalId } = await params;
  return (
    <MarketplaceProShell professionalId={professionalId}>
      <BookingInbox source={{ kind: "professional", professionalId }} />
    </MarketplaceProShell>
  );
}
