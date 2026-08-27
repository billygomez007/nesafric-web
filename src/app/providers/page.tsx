import { AppShell } from "@/components/app-shell";
import { ProviderDirectory } from "@/components/provider-directory";
import { ServiceCategoryManager } from "@/components/service-category-manager";

export default function ProvidersPage() {
  return (
    <AppShell
      description="Manage verified provider relationships without exposing a public marketplace."
      eyebrow="SERVICE NETWORK"
      title="Artisans and service providers"
    >
      <ProviderDirectory />
      <ServiceCategoryManager />
    </AppShell>
  );
}
