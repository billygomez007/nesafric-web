import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { MaintenanceRequestForm } from "@/components/maintenance-request-form";

export default function NewMaintenancePage() {
  return (
    <AppShell
      actions={
        <Link className="rounded-xl border border-hairline bg-white px-4 py-2.5 text-sm font-semibold text-muted transition-colors hover:bg-surface" href="/maintenance">
          Maintenance dashboard
        </Link>
      }
      description="Link the issue to the correct property, unit, and tenant relationship."
      eyebrow="NEW REQUEST"
      size="medium"
      title="Report maintenance issue"
    >
      <MaintenanceRequestForm />
    </AppShell>
  );
}
