import { AppShell } from "@/components/app-shell";
import { MaintenanceDashboard } from "@/components/maintenance-dashboard";

export default function MaintenancePage() {
  return (
    <AppShell
      description="Manage issues, approvals, internal assignments, work orders, and repair costs."
      eyebrow="PROPERTY OPERATIONS"
      title="Maintenance"
    >
      <MaintenanceDashboard />
    </AppShell>
  );
}
