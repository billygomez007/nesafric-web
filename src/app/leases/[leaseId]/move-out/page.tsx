import Link from "next/link";
import { MoveOutDashboard } from "@/components/move-out-dashboard";

export default async function LeaseMoveOutPage({ params }: { params: Promise<{ leaseId: string }> }) {
  const { leaseId } = await params;
  return <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12"><Link className="mb-6 inline-block text-sm font-semibold text-emerald-700" href={`/leases/${leaseId}`}>← Lease detail</Link><MoveOutDashboard leaseId={leaseId} /></main>;
}
