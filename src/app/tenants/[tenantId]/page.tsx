import { AppShell } from "@/components/app-shell";
import { TenantDetail } from "@/components/tenant-detail";

export default async function TenantDetailPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;

  return (
    <AppShell
      description="Tenant profile, lease history, communication preferences, payments and maintenance."
      eyebrow="TENANT"
      title="Tenant details"
    >
      <TenantDetail tenantId={tenantId} />
    </AppShell>
  );
}
