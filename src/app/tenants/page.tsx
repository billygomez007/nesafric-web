import Link from "next/link";

export default function TenantsPage() {
  return <main className="mx-auto max-w-6xl px-6 py-12"><header className="flex justify-between"><div><p className="text-sm font-semibold text-emerald-700">PEOPLE</p><h1 className="text-3xl font-semibold">Tenants</h1></div><Link className="rounded bg-slate-950 px-4 py-2 font-semibold text-white" href="/tenants/new">Add tenant</Link></header><div className="mt-8 rounded-xl border border-dashed p-12 text-center text-slate-600">Tenant records for the active organisation are available through the tenant API.</div></main>;
}
