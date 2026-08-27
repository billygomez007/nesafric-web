import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { ListingDashboard } from "@/components/listing-dashboard";

export default function ListingsPage() {
  return (
    <AppShell
      actions={
        <Link className="rounded-lg border px-4 py-2 text-sm font-semibold" href="/marketplace/properties">
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
