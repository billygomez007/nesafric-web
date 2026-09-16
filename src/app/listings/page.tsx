import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { ListingDashboard } from "@/components/listing-dashboard";

export default function ListingsPage() {
  return (
    <AppShell
      actions={
        <Link className="rounded-xl border border-hairline bg-white px-4 py-2.5 text-sm font-semibold text-muted transition-colors hover:bg-surface" href="/marketplace/properties">
          Public marketplace
        </Link>
      }
      description="Manage public marketing records independently from operational assets."
      eyebrow="PROPERTY MARKETPLACE"
      title="Listing management"
    >
      <ListingDashboard />
    </AppShell>
  );
}
