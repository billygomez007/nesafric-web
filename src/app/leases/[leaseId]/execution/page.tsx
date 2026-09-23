import { AppShell } from "@/components/app-shell";
import { LeaseExecutionDashboard } from "@/components/lease-execution-dashboard";

export default async function LeaseExecutionPage({
  params,
}: {
  params: Promise<{ leaseId: string }>;
}) {
  const { leaseId } = await params;

  return (
    <AppShell
      description="Prepare documents, signatures, move-in requirements and lease activation."
      eyebrow="LEASE WORKFLOW"
      title="Execution & move-in"
    >
      <LeaseExecutionDashboard leaseId={leaseId} />
    </AppShell>
  );
}
