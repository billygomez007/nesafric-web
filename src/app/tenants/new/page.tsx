import { AppShell } from "@/components/app-shell";
import { TenantForm } from "@/components/tenant-form";

export default function NewTenantPage() {
  return (
    <AppShell
      description="Create a tenant record for leases, payments, communication and maintenance activity in NesAfric."
      eyebrow="PEOPLE"
      size="narrow"
      title="Add tenant"
    >
      <TenantForm />
    </AppShell>
  );
}
