import Link from "next/link";
import { MaintenanceDetail } from "@/components/maintenance-detail";

export default async function MaintenanceRequestPage({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  return <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-12"><header className="mb-8"><p className="text-sm font-semibold text-emerald-700">MAINTENANCE REQUEST</p><h1 className="mt-1 text-3xl font-semibold">Issue detail and work history</h1><Link className="mt-3 inline-block text-sm font-semibold text-emerald-700" href="/maintenance">← Maintenance dashboard</Link></header><MaintenanceDetail requestId={requestId} /></main>;
}
