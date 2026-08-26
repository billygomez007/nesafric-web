import Link from "next/link";
import { LeaseList } from "@/components/lease-list";

export default function LeasesPage() {
  return <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12"><header className="flex flex-col justify-between gap-4 sm:flex-row"><div><p className="text-sm font-semibold text-emerald-700">LEASING</p><h1 className="text-3xl font-semibold">Leases</h1></div><Link className="self-start rounded bg-slate-950 px-4 py-2 font-semibold text-white" href="/leases/new">Create lease</Link></header><LeaseList /></main>;
}
