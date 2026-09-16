import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { TenantList } from "@/components/tenant-list";

export default function TenantsPage() {
  return (
    <AppShell
      actions={
        <Link
          className="inline-flex items-center gap-2 rounded-xl bg-forest px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-forest-light"
          href="/tenants/new"
        >
          <span className="text-base leading-none">+</span>
          Add tenant
        </Link>
      }
      description="Manage tenant records, contact details and occupancy relationships."
      eyebrow="PEOPLE"
      title="Tenants"
    >
      <TenantList />
    </AppShell>
  );
}
