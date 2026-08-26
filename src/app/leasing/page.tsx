import Link from "next/link";
import { LeasingDashboard } from "@/components/leasing-dashboard";

export default function LeasingPage() {
  return <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12"><header className="mb-8 flex flex-col justify-between gap-4 sm:flex-row"><div><p className="text-sm font-semibold text-emerald-700">LEASING CRM</p><h1 className="mt-1 text-3xl font-semibold">Prospects, viewings and applications</h1><p className="mt-2 text-slate-600">Manage the leasing pipeline without creating tenant records prematurely.</p></div><div className="flex gap-2"><Link className="self-start rounded-lg border px-4 py-2 text-sm font-semibold" href="/marketplace/properties">Marketplace</Link><Link className="self-start rounded-lg border px-4 py-2 text-sm font-semibold" href="/dashboard">Dashboard</Link></div></header><LeasingDashboard /></main>;
}
