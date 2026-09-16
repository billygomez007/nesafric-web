import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { LeasingDashboard } from "@/components/leasing-dashboard";

export default function LeasingPage() {
  return (
    <AppShell
      actions={
        <Link className="rounded-xl border border-hairline bg-white px-4 py-2.5 text-sm font-semibold text-muted transition-colors hover:bg-surface" href="/marketplace/properties">
          Public marketplace
        </Link>
      }
      description="Manage the leasing pipeline without creating tenant records prematurely."
      eyebrow="LEASING CRM"
      title="Prospects, viewings and applications"
    >
      <LeasingDashboard />
    </AppShell>
  );
}
