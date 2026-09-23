import { AppShell } from "@/components/app-shell";
import { TenantForm } from "@/components/tenant-form";

export default async function NewTenantPage({
  searchParams,
}: {
  searchParams: Promise<{ propertyId?: string; unitId?: string }>;
}) {
  const { propertyId, unitId } = await searchParams;

  return (
    <AppShell
      description="Create a tenant profile and optionally continue straight into the lease that connects them to a property and unit."
      eyebrow="PEOPLE"
      size="narrow"
      title="Add tenant"
    >
      <TenantForm
        initialPropertyId={propertyId}
        initialUnitId={unitId}
      />
    </AppShell>
  );
}
