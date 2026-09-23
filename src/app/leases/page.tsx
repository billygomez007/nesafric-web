import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { LeaseList } from "@/components/lease-list";

export default function LeasesPage() {
  return (
    <AppShell
      actions={
        <Link
          className="rounded-xl bg-forest px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-forest-light"
          href="/leases/new"
        >
          + Create lease
        </Link>
      }
      description="Manage active agreements, renewals, rent schedules and tenant occupancy."
      eyebrow="PROPERTY MANAGEMENT"
      title="Leases"
    >
      <LeaseList />
    </AppShell>
  );
}
