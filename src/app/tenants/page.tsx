import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { TenantList } from "@/components/tenant-list";

export default function TenantsPage() {
  return (
    <AppShell
      actions={
        <Link className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white" href="/tenants/new">
          Add tenant
        </Link>
      }
      eyebrow="PEOPLE"
      title="Tenants"
    >
      <TenantList />
    </AppShell>
  );
}
