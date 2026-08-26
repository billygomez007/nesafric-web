import Link from "next/link";
import { TenantList } from "@/components/tenant-list";

export default function TenantsPage() {
  return <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12"><header className="flex flex-col justify-between gap-4 sm:flex-row"><div><p className="text-sm font-semibold text-emerald-700">PEOPLE</p><h1 className="text-3xl font-semibold">Tenants</h1></div><Link className="self-start rounded bg-slate-950 px-4 py-2 font-semibold text-white" href="/tenants/new">Add tenant</Link></header><TenantList /></main>;
}
