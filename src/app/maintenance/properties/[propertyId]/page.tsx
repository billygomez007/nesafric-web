import Link from "next/link";
import { ScopedMaintenanceHistory } from "@/components/scoped-maintenance-history";

export default async function PropertyMaintenanceHistoryPage({ params }: { params: Promise<{ propertyId: string }> }) {
  const { propertyId } = await params;
  return <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-12"><header className="mb-8"><p className="text-sm font-semibold text-emerald-700">PROPERTY HISTORY</p><h1 className="mt-1 text-3xl font-semibold">Property maintenance</h1><p className="mt-2 text-slate-600">Complete issue and work-order history for this property.</p><Link className="mt-3 inline-block text-sm font-semibold text-emerald-700" href="/maintenance">← Maintenance dashboard</Link></header><section className="rounded-2xl border bg-white p-6 shadow-sm"><ScopedMaintenanceHistory scope="properties" id={propertyId} /></section></main>;
}
