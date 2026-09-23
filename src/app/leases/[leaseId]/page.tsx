import { AppShell } from "@/components/app-shell";
import { LeaseDetail } from "@/components/lease-detail";

export default async function LeaseDetailPage({
  params,
}: {
  params: Promise<{ leaseId: string }>;
}) {
  const { leaseId } = await params;

  return (
    <AppShell
      description="Lease terms, tenants, renewals, rent schedule, payments and activity."
      eyebrow="LEASE RECORD"
      title="Lease details"
    >
      <LeaseDetail leaseId={leaseId} />
    </AppShell>
  );
}
