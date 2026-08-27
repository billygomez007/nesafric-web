import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { LeaseList } from "@/components/lease-list";

export default function LeasesPage() {
  return (
    <AppShell
      actions={
        <Link className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white" href="/leases/new">
          Create lease
        </Link>
      }
      eyebrow="LEASING"
      title="Leases"
    >
      <LeaseList />
    </AppShell>
  );
}
