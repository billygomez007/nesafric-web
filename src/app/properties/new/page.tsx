import { AppShell } from "@/components/app-shell";
import { PropertyForm } from "@/components/property-form";

export default function NewPropertyPage() {
  return (
    <AppShell eyebrow="ASSETS" size="narrow" title="Add property">
      <PropertyForm />
    </AppShell>
  );
}
