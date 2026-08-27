import { AppShell } from "@/components/app-shell";
import { PropertyDetail } from "@/components/property-detail";

export default async function PropertyDetailPage({ params }: { params: Promise<{ propertyId: string }> }) {
  const { propertyId } = await params;
  return (
    <AppShell eyebrow="ASSETS" title="Property">
      <PropertyDetail propertyId={propertyId} />
    </AppShell>
  );
}
