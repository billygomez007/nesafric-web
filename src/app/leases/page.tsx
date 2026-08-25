import Link from "next/link";

export default function LeasesPage() {
  return <main className="mx-auto max-w-6xl px-6 py-12"><header className="flex justify-between"><div><p className="text-sm font-semibold text-emerald-700">LEASING</p><h1 className="text-3xl font-semibold">Leases</h1></div><Link className="rounded bg-slate-950 px-4 py-2 font-semibold text-white" href="/leases/new">Create lease</Link></header><div className="mt-8 rounded-xl border border-dashed p-12 text-center text-slate-600">Lease history, status, dates, and related tenants are available through the lease API.</div></main>;
}
