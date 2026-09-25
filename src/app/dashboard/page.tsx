import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { DashboardContent } from "@/components/dashboard-content";

export default function DashboardPage() {
  return (
    <AppShell
      actions={
        <div className="flex flex-wrap gap-2">
          <Link
            className="rounded-xl border border-hairline bg-white px-4 py-2.5 text-sm font-semibold text-forest transition hover:border-teal/30 hover:text-teal"
            href="/tenants/new"
          >
            Add tenant
          </Link>
          <Link
            className="rounded-xl bg-forest px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-forest-light"
            href="/properties/new"
          >
            + Add property
          </Link>
        </div>
      }
      description="Rent, properties, maintenance and your team for this organisation."
      eyebrow="PROPERTY MANAGEMENT"
      title="Portfolio"
    >
      <DashboardContent />
    </AppShell>
  );
}
