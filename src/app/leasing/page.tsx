import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { LeasingDashboard } from "@/components/leasing-dashboard";

export default function LeasingPage() {
  return (
    <AppShell
      actions={
        <Link className="rounded-lg border px-4 py-2 text-sm font-semibold" href="/marketplace/properties">
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
