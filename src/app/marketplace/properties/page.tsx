import Link from "next/link";
import { PropertyMarketplaceSearch } from "@/components/property-marketplace-search";

export default function PropertyMarketplacePage() {
  return <main className="min-h-screen bg-slate-50"><header className="border-b bg-emerald-950 px-4 py-12 text-white sm:px-6"><div className="mx-auto max-w-7xl"><nav className="flex flex-wrap justify-between gap-4"><Link className="font-semibold" href="/">PropertyOS</Link><div className="flex gap-4 text-sm"><Link href="/marketplace">Find artisans</Link><Link href="/listings">Manage listings</Link><Link href="/dashboard">Dashboard</Link></div></nav><p className="mt-12 text-sm font-semibold tracking-wider text-emerald-300">PROPERTY MARKETPLACE</p><h1 className="mt-2 max-w-3xl text-4xl font-semibold sm:text-5xl">Find your next property.</h1><p className="mt-4 max-w-2xl text-emerald-100">Verified, currently available properties and units linked to managed assets.</p></div></header><div className="mx-auto max-w-7xl px-4 py-8 sm:px-6"><PropertyMarketplaceSearch /></div></main>;
}
