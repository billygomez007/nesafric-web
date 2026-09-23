import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { DashboardContent } from "@/components/dashboard-content";

export default function DashboardPage() {
  return (
    <AppShell
      actions={
        <Link
          className="rounded-xl bg-forest px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-forest-light"
          href="/properties/new"
        >
          Add property
        </Link>
      }
      eyebrow="NESAFRIC"
      title="Good morning"
      description="Here’s what’s happening with your properties today."
    >
      <DashboardContent />
    </AppShell>
  );
}
