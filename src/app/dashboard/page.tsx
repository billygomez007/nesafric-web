import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { DashboardContent } from "@/components/dashboard-content";

export default function DashboardPage() {
  return (
    <AppShell
      actions={
        <Link className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white" href="/properties/new">
          Add property
        </Link>
      }
      eyebrow="PROPERTYOS"
      title="Organisation dashboard"
    >
      <DashboardContent />
    </AppShell>
  );
}
