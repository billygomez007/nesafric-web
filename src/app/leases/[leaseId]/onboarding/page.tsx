import { AppShell } from "@/components/app-shell";
import { LeaseExecutionDashboard } from "@/components/lease-execution-dashboard";

export default async function TenantOnboardingPage({
  params,
}: {
  params: Promise<{ leaseId: string }>;
}) {
  const { leaseId } = await params;

  return (
    <AppShell
      description="Track tenant readiness, documents, signatures, inspections and move-in."
      eyebrow="TENANT JOURNEY"
      title="Tenant onboarding"
    >
      <LeaseExecutionDashboard leaseId={leaseId} onboarding />
    </AppShell>
  );
}
