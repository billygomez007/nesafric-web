import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { MaintenanceRequestForm } from "@/components/maintenance-request-form";

export default function NewMaintenancePage() {
  return (
    <AppShell
      actions={
        <Link className="rounded-lg border px-4 py-2 text-sm font-semibold" href="/maintenance">
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
