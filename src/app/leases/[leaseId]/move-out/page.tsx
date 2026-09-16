import { AppShell } from "@/components/app-shell";
import { MoveOutDashboard } from "@/components/move-out-dashboard";

export default async function LeaseMoveOutPage({
  params,
}: {
  params: Promise<{ leaseId: string }>;
}) {
  const { leaseId } = await params;

  return (
    <AppShell
      description="Manage move-out inspections, settlement, deposit handling and turnover."
      eyebrow="LEASE CLOSEOUT"
      title="Move-out"
    >
      <MoveOutDashboard leaseId={leaseId} />
    </AppShell>
  );
}
