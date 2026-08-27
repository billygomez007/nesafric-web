import { AppShell } from "@/components/app-shell";
import { TenantForm } from "@/components/tenant-form";

export default function NewTenantPage() {
  return (
    <AppShell description="A tenant record is separate from a UmoAfric user account." eyebrow="PEOPLE" size="narrow" title="Add tenant">
      <TenantForm />
    </AppShell>
  );
}
