import { AppShell } from "@/components/app-shell";
import { LeaseForm } from "@/components/lease-form";

export default async function NewLeasePage({
  searchParams,
}: {
  searchParams: Promise<{
    propertyId?: string;
    unitId?: string;
    tenantId?: string;
  }>;
}) {
  const { propertyId, unitId, tenantId } = await searchParams;

  return (
    <AppShell
      description="Choose a property and optional unit, then assign one or more organisation-scoped tenant records."
      eyebrow="LEASING"
      size="narrow"
      title="Create lease"
    >
      <LeaseForm
        initialPropertyId={propertyId}
        initialTenantId={tenantId}
        initialUnitId={unitId}
      />
    </AppShell>
  );
}
