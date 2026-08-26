import Link from "next/link";
import { MaintenanceRequestForm } from "@/components/maintenance-request-form";

export default function NewMaintenancePage() {
  return <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12"><header className="mb-8"><p className="text-sm font-semibold text-emerald-700">NEW REQUEST</p><h1 className="mt-1 text-3xl font-semibold">Report maintenance issue</h1><p className="mt-2 text-slate-600">Link the issue to the correct property, unit, and tenant relationship.</p><Link className="mt-3 inline-block text-sm font-semibold text-emerald-700" href="/maintenance">← Maintenance dashboard</Link></header><MaintenanceRequestForm /></main>;
}
