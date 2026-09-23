import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { ScopedMaintenanceHistory } from "@/components/scoped-maintenance-history";

export default async function PropertyMaintenanceHistoryPage({ params }: { params: Promise<{ propertyId: string }> }) {
  const { propertyId } = await params;
  return <AppShell actions={<Link className="rounded-xl border border-hairline bg-white px-4 py-2.5 text-sm font-semibold text-muted transition-colors hover:bg-surface" href="/maintenance">Back to maintenance</Link>} description="Complete issue and work-order history for this property." eyebrow="PROPERTY HISTORY" title="Property maintenance"><section className="rounded-2xl border border-hairline bg-white p-6 shadow-sm"><ScopedMaintenanceHistory scope="properties" id={propertyId} /></section></AppShell>;
}
